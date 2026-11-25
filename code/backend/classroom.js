import { randomUUID } from 'node:crypto';
import { ActiveDecisionEngine } from '../core_engine/index.js';
import { createLearningAgent } from '../core_engine/learning_agent/agent.js';
import { projectLearningMemory } from '../core_engine/learning_agent/memory.js';
import { hintAt, lesson, questions } from './classroom-content.js';
import { isRecord, maximumSealedBytes, readBoundedFile, replacePrivateFile } from './classroom-protection.js';

const actions = new Set(['answer', 'help', 'toggle-help']);
const phases = new Set(['practice', 'verification', 'complete']);
const identifierPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const pointValueMisconception = 'limit_equals_function_value';
const maxSessions = 500;
const maxEvents = 120;

export class ClassroomError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isSavedSession(session) {
  return isRecord(session)
    && typeof session.id === 'string'
    && Number.isSafeInteger(session.revision)
    && phases.has(session.phase)
    && isRecord(session.result)
    && Array.isArray(session.events)
    && session.events.length === session.revision
    && session.events.every(isRecord);
}

function isSavedClassroom(classroom) {
  return isRecord(classroom)
    && typeof classroom.published === 'boolean'
    && Array.isArray(classroom.sessions)
    && classroom.sessions.every(isSavedSession);
}

function loadClassroom(filePath, protection) {
  const initial = { published: false, sessions: [] };
  if (!filePath) return initial;
  try {
    const saved = readBoundedFile(filePath, maximumSealedBytes);
    const classroom = protection ? protection.open(saved) : JSON.parse(saved);
    if (!isSavedClassroom(classroom)) throw new Error('课堂记录结构无效。');
    return classroom;
  } catch (error) {
    if (error.code === 'ENOENT') return initial;
    throw new Error('无法读取有效的课堂记录，请检查 CLASSROOM_FILE。', { cause: error });
  }
}

function saveClassroom(filePath, classroom, protection) {
  if (!filePath) return;
  const encoded = protection ? protection.seal(classroom) : JSON.stringify(classroom);
  if (Buffer.byteLength(encoded) > maximumSealedBytes) throw new ClassroomError(409, '课堂存储已达上限。');
  replacePrivateFile(filePath, encoded);
}

function newSession(startKey, owner) {
  return {
    id: randomUUID(),
    startKey,
    owner,
    revision: 0,
    phase: 'practice',
    helpEnabled: true,
    hint: null,
    currentLevel: 0,
    proactiveHints: 0,
    lastHintAt: null,
    feedback: null,
    result: {
      practiceAttempts: 0, usedHint: false, verificationAttempts: 0, firstPass: false, completed: false
    },
    events: []
  };
}

function publicQuestion(phase) {
  const question = questions[phase];
  if (!question) return null;
  return { id: question.id, prompt: question.prompt, choices: question.choices };
}

function projectSession(session) {
  const { id, revision, phase, helpEnabled, hint, feedback, result } = session;
  return structuredClone({
    id, revision, phase, question: publicQuestion(phase),
    helpEnabled: phase === 'practice' && helpEnabled, hint, feedback, result
  });
}

function isIdentifier(value) {
  return typeof value === 'string' && identifierPattern.test(value);
}

function parseEvent(input) {
  if (!isRecord(input)) {
    throw new ClassroomError(400, '请提交课堂操作对象。');
  }
  const { eventId, revision, action } = input;
  if (!isIdentifier(eventId)) {
    throw new ClassroomError(400, '课堂操作编号须为 1 到 100 个字母、数字、横线或下划线。');
  }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new ClassroomError(400, '课堂会话版本须为非负整数。');
  }
  if (!actions.has(action)) throw new ClassroomError(400, '未知的课堂操作。');
  return { eventId, revision, action, choice: input.choice ?? null };
}

function isDuplicate(session, event) {
  const previous = session.events.find(item => item.eventId === event.eventId);
  if (!previous) return false;
  if (previous.revision !== event.revision || previous.action !== event.action || previous.choice !== event.choice) {
    throw new ClassroomError(409, '该操作编号已被使用，请刷新后重试。');
  }
  return true;
}

function verifyEvent(session, event) {
  if (event.revision !== session.revision) throw new ClassroomError(409, '会话已有更新，请刷新后重试。');
  if (session.phase === 'complete') throw new ClassroomError(409, '本轮课堂任务已完成。');
  if (session.phase === 'verification' && event.action !== 'answer') {
    throw new ClassroomError(409, '独立验证阶段仅接受答题。');
  }
  if (event.action === 'answer' && !questions[session.phase].choices.some(option => option.id === event.choice)) {
    throw new ClassroomError(400, '请选择当前题目的一个答案。');
  }
  if (event.action !== 'answer' && event.choice !== null) {
    throw new ClassroomError(400, '该操作无需提交答案。');
  }
}

function checkEventCapacity(session) {
  if (session.events.length >= maxEvents) throw new ClassroomError(409, '本轮记录已达上限，请开始新一轮。');
}

function feedback(session, type, message) {
  session.feedback = { type, message };
}

async function deliverHint(session, event, agent) {
  const requestedHelp = event.action === 'help';
  const now = Date.parse(event.at);
  const memory = projectLearningMemory(session.events, event.misconception);
  const { hint, trace } = await agent({
    phase: session.phase, helpEnabled: session.helpEnabled, courseVersion: lesson.id, memory,
    decisionContext: {
      consecutiveErrors: session.result.practiceAttempts,
      requestedHelp,
      interventionsUsed: session.proactiveHints,
      secondsSinceLastIntervention: session.lastHintAt === null ? null : Math.max(0, now - session.lastHintAt) / 1000,
      currentLevel: session.currentLevel,
      misconceptionType: memory.misconception
    }
  });
  event.agent = trace;
  if (!hint) return false;
  session.hint = { ...hint, trace };
  session.currentLevel = hint.level;
  session.lastHintAt = now;
  session.result.usedHint = true;
  if (!requestedHelp) session.proactiveHints += 1;
  event.hintLevel = hint.level;
  return true;
}

async function gradePractice(session, event, agent) {
  session.result.practiceAttempts += 1;
  if (event.correct) {
    session.phase = 'verification';
    session.hint = null;
    feedback(session, 'correct', '练习答对了。现在完成一道无提示的独立验证题。');
    return;
  }
  feedback(session, 'incorrect', '这个选项不正确，请再试一次。');
  await deliverHint(session, event, agent);
}

function gradeVerification(session, event) {
  session.result.verificationAttempts += 1;
  if (event.correct) {
    session.phase = 'complete';
    session.result.firstPass = session.result.verificationAttempts === 1;
    session.result.completed = true;
    feedback(session, 'correct', '独立验证答对了。');
    return;
  }
  feedback(session, 'incorrect', '这个选项不正确，请再试一次。');
}

function toggleHelp(session) {
  session.helpEnabled = !session.helpEnabled;
  session.hint = null;
  feedback(session, 'info', session.helpEnabled ? '已恢复本题提示。' : '已关闭本题提示。');
}

async function applyEvent(session, input, agent) {
  const { phase } = session;
  const event = {
    ...input, phase, correct: null, misconception: null, hintLevel: null, at: new Date().toISOString()
  };
  if (event.action === 'answer') {
    event.correct = event.choice === questions[phase].answer;
    if (event.choice === questions[phase].pointValue) event.misconception = pointValueMisconception;
    if (phase === 'practice') await gradePractice(session, event, agent);
    else gradeVerification(session, event);
  } else if (event.action === 'help') {
    const delivered = await deliverHint(session, event, agent);
    feedback(session, 'info', delivered ? '已提供线索。' : '当前没有提供线索。');
  } else {
    toggleHelp(session);
  }
  session.revision += 1;
  session.events.push(event);
}

function teacherSession({ id, revision, phase, result, events }) {
  return { id, revision, phase, result, timeline: events };
}

function summarize(sessions) {
  const count = predicate => sessions.filter(predicate).length;
  return {
    sessions: sessions.length,
    practiceCompleted: count(session => session.phase !== 'practice'),
    verificationStarted: count(session => session.result.verificationAttempts > 0),
    firstPass: count(session => session.result.firstPass),
    completed: count(session => session.result.completed),
    usedHint: count(session => session.result.usedHint)
  };
}

export function createClassroom({ filePath, protection, engine = new ActiveDecisionEngine(), agent = createLearningAgent({
  engine, approvedFallback: hintAt
}) } = {}) {
  let classroom = loadClassroom(filePath, protection);

  function commit(next) {
    saveClassroom(filePath, next, protection);
    classroom = next;
  }

  function overview() {
    return { published: classroom.published, lesson };
  }

  function findSession(id, owner) {
    const session = classroom.sessions.find(item => item.id === id && item.owner === owner);
    if (!session) throw new ClassroomError(404, '未找到该课堂会话。');
    return session;
  }

  return {
    overview,
    publish() {
      if (!classroom.published) commit({ ...classroom, published: true });
      return overview();
    },
    createSession(startKey, owner) {
      if (startKey !== undefined && !isIdentifier(startKey)) {
        throw new ClassroomError(400, '开始课堂编号须为 1 到 100 个字母、数字、横线或下划线。');
      }
      if (!classroom.published) throw new ClassroomError(409, '课堂任务尚未发布。');
      if (startKey !== undefined) {
        const existing = classroom.sessions.find(session => session.startKey === startKey && session.owner === owner);
        if (existing) return projectSession(existing);
      }
      if (classroom.sessions.length >= maxSessions) throw new ClassroomError(409, '课堂记录已达上限。');
      const session = newSession(startKey, owner);
      commit({ ...classroom, sessions: [...classroom.sessions, session] });
      return projectSession(session);
    },
    getSession(id, owner) {
      return projectSession(findSession(id, owner));
    },
    async submit(id, input, owner) {
      const session = findSession(id, owner);
      const event = parseEvent(input);
      if (isDuplicate(session, event)) return projectSession(session);
      verifyEvent(session, event);
      checkEventCapacity(session);
      const updated = structuredClone(session);
      await applyEvent(updated, event, agent);
      const current = findSession(id, owner);
      if (isDuplicate(current, event)) return projectSession(current);
      verifyEvent(current, event);
      const sessions = classroom.sessions.map(item => item.id === id ? updated : item);
      commit({ ...classroom, sessions });
      return projectSession(updated);
    },
    teacherOverview() {
      const sessions = classroom.sessions.map(teacherSession);
      return structuredClone({ ...overview(), summary: summarize(sessions), sessions: sessions.slice(-20) });
    }
  };
}
