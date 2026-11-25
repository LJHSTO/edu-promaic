const byId = id => document.getElementById(id);
const phaseLabels = {
  reading: '阅读材料',
  practice: '概念练习',
  verification: '独立验证',
  complete: '预习结果'
};
const phaseOrder = Object.keys(phaseLabels);
const selectedClass = new URLSearchParams(location.search).get('class');
const classroomQuery = selectedClass ? `?${new URLSearchParams({ class: selectedClass })}` : '';
const storageScope = selectedClass ? `.${encodeURIComponent(selectedClass)}` : '';
const storageKeys = {
  session: `edu-promaic.classroom.session${storageScope}`,
  start: `edu-promaic.classroom.start${storageScope}`
};
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium' });
const agentOutcomes = {
  grounded: '已提供有课程依据的线索',
  fallback: '已使用课程预设线索',
  silent: '未触发线索',
  blocked: '当前条件下不提供线索'
};
const agentSteps = {
  guard: '核对当前学习阶段',
  policy: '判断提示时机与层级',
  memory: '读取本轮作答与已用材料',
  'concept-graph': '关联当前知识点和相邻概念',
  retrieve: '检索课程知识片段',
  'retrieve-related': '补查相关概念的知识片段',
  'model-rank': '请模型从候选课程材料中选择',
  'rank-locally': '按检索顺序选择课程材料',
  compose: '根据材料组织线索',
  validate: '校验线索与引用',
  fallback: '采用课程预设线索'
};
const agentTools = {
  expand_course_concept: '扩展课程概念',
  retrieve_course_passages: '查找课程段落',
  compare_point_neighborhood: '计算点值与附近数值的对照'
};

const state = {
  view: 'student',
  overview: null,
  teacher: null,
  session: null,
  sessionId: readStoredValue(storageKeys.session),
  startKey: readStoredValue(storageKeys.start),
  teacherSelection: null,
  pendingEvent: null,
  busy: false,
  refreshQueued: false,
  retry: null
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readStoredValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeValue(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // The in-page session still works when browser storage is restricted.
  }
}

function rememberSession(id) {
  state.sessionId = id;
  storeValue(storageKeys.session, id);
}

function rememberStartKey(key) {
  state.startKey = key;
  storeValue(storageKeys.start, key);
}

function apiFailureMessage(status, result) {
  if (typeof result?.error === 'string') return result.error;
  if (status === 401) return '请登录后重新打开课堂。';
  if (status === 403) return '当前账号无法访问该班级或入口。';
  return '课堂服务暂时无法处理请求，请重试。';
}

async function api(path = '', { method = 'GET', payload, headers } = {}) {
  const options = { method, headers, signal: AbortSignal.timeout(8000), cache: 'no-store', credentials: 'same-origin' };
  if (payload) {
    options.headers = { ...headers, 'Content-Type': 'application/json' };
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(`/api/classroom${path}${classroomQuery}`, options).catch(() => {
    throw new ApiError(0, '课堂服务暂时无法连接，请重试。');
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true) {
    throw new ApiError(response.status, apiFailureMessage(response.status, result));
  }
  return result.data;
}

function sessionPath(id) {
  return `/sessions/${encodeURIComponent(id)}`;
}

function selectedChoice() {
  return document.querySelector('input[name="choice"]:checked')?.value;
}

function showError(message, retry = null) {
  state.retry = retry;
  byId('requestErrorText').textContent = message;
  byId('requestError').hidden = !message;
  byId('retryButton').hidden = !retry;
}

function updateControls() {
  const { busy, pendingEvent, session } = state;
  for (const id of ['reloadClassroom', 'publishLesson', 'refreshTeacher', 'retryButton']) {
    byId(id).disabled = busy;
  }
  byId('startSession').disabled = busy || Boolean(state.sessionId);
  const studentBusy = busy || Boolean(pendingEvent);
  byId('answerGroup').disabled = studentBusy;
  byId('submitAnswer').disabled = studentBusy || !selectedChoice();
  byId('requestHint').disabled = studentBusy || !session?.helpEnabled;
  byId('toggleHelp').disabled = studentBusy;
  byId('newSession').disabled = studentBusy;
  byId('answerForm').setAttribute('aria-busy', String(busy));
}

async function runTask(task, onError = () => task) {
  if (state.busy) return;
  const view = state.view;
  state.busy = true;
  showError('');
  render();
  try {
    await task();
  } catch (error) {
    const retry = onError(error);
    if (state.view === view) {
      showError(error instanceof ApiError ? error.message : '暂时无法加载课堂。请重试。', retry);
      byId('requestError').scrollIntoView({ block: 'nearest' });
    }
  } finally {
    state.busy = false;
    render();
    if (state.refreshQueued) refreshView();
  }
}

function render() {
  const teacherView = state.view === 'teacher';
  const loaded = teacherView ? state.teacher : state.overview;
  byId('loadingMessage').hidden = Boolean(loaded) || !state.busy;
  byId('studentView').hidden = teacherView || !loaded;
  byId('teacherView').hidden = !teacherView || !loaded;
  if (loaded) {
    if (teacherView) renderTeacher();
    else renderStudent();
  }
  updateControls();
}

function setSource(element, source) {
  element.hidden = true;
  element.removeAttribute('href');
  element.textContent = '';
  if (!source?.url) return;
  let url;
  try {
    url = new URL(source.url, location.href);
  } catch {
    return;
  }
  if (!['https:', 'http:'].includes(url.protocol)) return;
  element.href = url.href;
  element.target = '_blank';
  element.rel = 'noopener noreferrer';
  element.textContent = source.label;
  element.hidden = false;
}

function renderStudent() {
  const { overview, session } = state;
  byId('studentTitle').textContent = overview.lesson.title;
  byId('studentObjective').textContent = overview.lesson.objective;
  byId('unpublished').hidden = overview.published;
  byId('published').hidden = !overview.published;
  const phase = session?.phase ?? 'reading';
  const phaseIndex = phaseOrder.indexOf(phase);
  for (const step of byId('progressSteps').children) {
    const current = step.dataset.phase === phase;
    if (current) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
    step.classList.toggle('is-past', phaseOrder.indexOf(step.dataset.phase) < phaseIndex);
  }
  byId('reading').hidden = phase !== 'reading';
  byId('exercise').hidden = !session?.question;
  byId('result').hidden = phase !== 'complete';
  byId('prework').textContent = overview.lesson.prework;
  byId('startSession').textContent = state.startKey ? '恢复概念练习' : '开始概念练习';
  setSource(byId('lessonSource'), overview.lesson.source);
  renderExercise(session);
  if (phase === 'complete') renderResults(session.result);
}

function makeChoice(choice) {
  const label = document.createElement('label');
  const input = document.createElement('input');
  const letter = document.createElement('span');
  input.type = 'radio';
  input.name = 'choice';
  input.value = choice.id;
  letter.className = 'choice-letter';
  letter.textContent = choice.id.toUpperCase();
  label.append(input, letter, document.createTextNode(choice.text));
  return label;
}

function renderQuestion(session) {
  const options = byId('answerOptions');
  const question = session?.question;
  const id = session?.id;
  const questionKey = question ? `${id}/${question.id}` : '';
  if (options.dataset.question !== questionKey) {
    options.replaceChildren(...(question?.choices ?? []).map(makeChoice));
    options.dataset.question = questionKey;
  }
  byId('questionPrompt').textContent = question?.prompt ?? '';
}

function renderExercise(session) {
  const { phase, feedback } = session ?? {};
  renderQuestion(session);
  byId('questionTitle').textContent = phaseLabels[phase] ?? '';
  byId('verificationNote').hidden = phase !== 'verification';
  byId('answerFeedback').hidden = !feedback;
  byId('answerFeedback').textContent = feedback?.message ?? '';
  byId('answerFeedback').dataset.kind = feedback?.type ?? '';
  renderHelp(phase === 'practice' ? session : null);
}

function setOptionalText(id, text) {
  const node = byId(id);
  node.hidden = !text;
  node.textContent = text;
}

function labelFor(dictionary, key) {
  return typeof key === 'string' && Object.hasOwn(dictionary, key) ? dictionary[key] : '';
}

function labelsFor(dictionary, keys) {
  if (!Array.isArray(keys)) return [];
  return [...new Set(keys.map(key => labelFor(dictionary, key)).filter(Boolean))];
}

function setList(id, rows) {
  const list = byId(id);
  list.hidden = rows.length === 0;
  list.replaceChildren(...rows);
}

function makeStage(text) {
  const row = document.createElement('li');
  row.textContent = text;
  return row;
}

function makeCitation(citation) {
  const link = document.createElement('a');
  link.className = 'source-link';
  setSource(link, citation);
  if (link.hidden) return null;
  const row = document.createElement('li');
  const reference = document.createElement('small');
  reference.textContent = [citation.section, citation.courseVersion].filter(Boolean).join(' · ');
  row.append(link, reference);
  return row;
}

function renderHintEvidence(hint, citations) {
  const trace = hint?.trace;
  const details = byId('hintEvidence');
  details.hidden = !trace && citations.length === 0;
  if (details.hidden) details.open = false;
  setOptionalText('hintOutcome', labelFor(agentOutcomes, trace?.outcome));
  const pointValueErrors = trace?.memory?.pointValueErrors;
  const observation = Number.isSafeInteger(pointValueErrors) && pointValueErrors > 0
    ? `近期记录中有 ${pointValueErrors} 次把点值当作极限的作答。` : '';
  setOptionalText('hintMemory', observation);
  setList('hintSteps', labelsFor(agentSteps, trace?.steps).map(makeStage));
  setList('hintCitations', citations.map(makeCitation).filter(Boolean));
}

function renderHint(hint) {
  setOptionalText('hintText', hint?.text ?? '');
  const example = hint?.example?.text ?? '';
  byId('hintExample').hidden = !example;
  byId('hintExampleText').textContent = example;
  const citations = hint?.citations ?? [];
  setSource(byId('hintSource'), citations[0] ?? hint?.source);
  renderHintEvidence(hint, citations);
}

function renderHelp(session) {
  const hint = session?.hint;
  const enabled = session?.helpEnabled;
  byId('practiceHelp').hidden = !session;
  const status = enabled ? '先尝试作答，卡住时可以获取线索。' : '本题提示已暂停。';
  setOptionalText('hintStatus', hint ? '' : status);
  renderHint(hint);
  byId('requestHint').textContent = hint ? '再给一点线索' : '获取线索';
  byId('toggleHelp').textContent = enabled ? '暂停提示' : '恢复提示';
}

function renderResults(result) {
  const practiceDetail = result.usedHint ? '使用过线索' : '独立完成';
  byId('practiceResult').textContent = `${practiceDetail} · ${result.practiceAttempts} 次作答`;
  byId('verificationResult').textContent = result.firstPass ? '首次通过' : `第 ${result.verificationAttempts} 次作答后通过`;
}

function renderTeacher() {
  const { published, lesson, summary, sessions } = state.teacher;
  byId('publishTitle').textContent = lesson.title;
  byId('teacherObjective').textContent = lesson.objective;
  byId('publishStatus').textContent = published ? '已发布' : '待发布';
  byId('publishLesson').hidden = published;
  byId('openStudent').hidden = !published;
  for (const metric of document.querySelectorAll('[data-metric]')) {
    metric.textContent = summary[metric.dataset.metric];
  }
  byId('sessionsEmpty').hidden = Boolean(sessions.length);
  byId('recentSessions').replaceChildren(...sessions.toReversed().slice(0, 20).map(makeSessionRow));
  renderReplay();
}

function sessionLabel(id) {
  return `匿名记录 ${id.slice(0, 8)}`;
}

function makeSessionRow(session) {
  const row = document.createElement('li');
  const button = document.createElement('button');
  const summary = document.createElement('small');
  button.type = 'button';
  button.dataset.session = session.id;
  summary.textContent = session.result.completed ? '已完成预习' : phaseLabels[session.phase];
  button.append(document.createTextNode(sessionLabel(session.id)), summary);
  row.append(button);
  return row;
}

function renderReplay() {
  const selected = state.teacher.sessions.find(session => session.id === state.teacherSelection);
  for (const button of byId('recentSessions').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.session === selected?.id));
  }
  byId('replayEmpty').hidden = Boolean(selected);
  byId('replayContent').hidden = !selected;
  if (!selected) return;
  const { result, timeline } = selected;
  const details = [
    sessionLabel(selected.id),
    `练习 ${result.practiceAttempts} 次`,
    `验证 ${result.verificationAttempts} 次`
  ];
  if (result.completed) details.push(result.firstPass ? '验证首次通过' : '验证重试后通过');
  byId('replaySummary').textContent = details.join(' · ');
  byId('timelineEmpty').hidden = Boolean(timeline.length);
  byId('timeline').replaceChildren(...timeline.map(makeTimelineEntry));
}

function timelineLabel(event) {
  if (event.action === 'answer') {
    const choice = event.choice.toUpperCase();
    const outcome = event.correct ? '答对' : '答错';
    const misconception = event.misconception === 'limit_equals_function_value' ? ' · 选了该点的函数值' : '';
    return `${phaseLabels[event.phase]} · 选择 ${choice} · ${outcome}${misconception}`;
  }
  if (event.action === 'help') return '主动获取线索';
  if (event.action === 'toggle-help') return '调整提示设置';
  return '开始课前预习';
}

function makeAgentReceipt(trace) {
  const outcome = labelFor(agentOutcomes, trace.outcome);
  const tools = labelsFor(agentTools, trace.tools);
  const sourceCount = trace.sourceIds?.length ?? 0;
  const sources = sourceCount ? `引用 ${sourceCount} 个课程片段` : '';
  const selection = labelsFor(agentSteps, (trace.steps ?? []).filter(step => ['model-rank', 'rank-locally'].includes(step)));
  const text = [outcome, ...tools, ...selection, sources].filter(Boolean).join(' · ');
  const receipt = document.createElement('p');
  receipt.className = 'timeline-agent';
  receipt.hidden = text.length === 0;
  receipt.textContent = text;
  return receipt;
}

function makeTimelineEntry(event) {
  const row = document.createElement('li');
  const time = document.createElement('time');
  const date = new Date(event.at);
  let label = timelineLabel(event);
  if (event.hintLevel) label += ` · 线索 L${event.hintLevel}`;
  time.dateTime = date.toISOString();
  time.textContent = dateFormat.format(date);
  row.append(label, time);
  if (event.agent) row.append(makeAgentReceipt(event.agent));
  return row;
}

async function loadStudent() {
  state.overview = await api();
  if (!state.overview.published || !state.sessionId) return;
  try {
    state.session = await api(sessionPath(state.sessionId));
    if (state.startKey) rememberStartKey(null);
  } catch (error) {
    if (error.status !== 404) throw error;
    state.session = null;
    state.pendingEvent = null;
    rememberSession(null);
  }
}

async function loadTeacher() {
  state.teacher = await api('/teacher');
  const { published, lesson } = state.teacher;
  state.overview = { published, lesson };
}

function refreshView() {
  state.refreshQueued = state.busy;
  if (state.busy) return;
  if (state.view === 'teacher') void runTask(loadTeacher);
  else if (state.pendingEvent) sendPendingEvent();
  else void runTask(loadStudent);
}

function navigate() {
  const nextView = location.hash === '#teacher' ? 'teacher' : 'student';
  const changed = nextView !== state.view;
  state.view = nextView;
  for (const view of ['student', 'teacher']) {
    const link = byId(`${view}Link`);
    if (view === nextView) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (changed) showError('');
  render();
  refreshView();
}

async function publishLesson() {
  const overview = await api('/publish', { method: 'POST' });
  state.overview = overview;
  state.teacher = { ...state.teacher, ...overview };
  render();
  if (state.view === 'teacher') byId('openStudent').focus();
}

async function startSession() {
  if (!state.startKey) rememberStartKey(crypto.randomUUID());
  const session = await api('/sessions', {
    method: 'POST', headers: { 'Idempotency-Key': state.startKey }
  });
  state.session = session;
  rememberSession(session.id);
  rememberStartKey(null);
  render();
  if (state.view === 'student') byId('questionTitle').focus();
}

async function deliverEvent() {
  const { sessionId, payload } = state.pendingEvent;
  const path = sessionPath(sessionId);
  const previousPhase = state.session.phase;
  try {
    state.session = await api(`${path}/events`, { method: 'POST', payload });
  } catch (error) {
    if (error.status !== 409) throw error;
    state.session = await api(path);
    state.pendingEvent = null;
    throw new ApiError(409, '预习记录已更新。请查看当前进度后继续。');
  }
  state.pendingEvent = null;
  if (state.view !== 'student' || previousPhase === state.session.phase) return;
  render();
  byId(state.session.phase === 'complete' ? 'resultTitle' : 'questionTitle').focus();
}

function retryEvent(error) {
  if (error.status === 409) return null;
  if (error.status >= 400 && error.status < 500) {
    state.pendingEvent = null;
    return error.status === 404 ? loadStudent : null;
  }
  return deliverEvent;
}

function sendPendingEvent() {
  void runTask(deliverEvent, retryEvent);
}

function sendEvent(action, choice) {
  if (state.busy || state.pendingEvent || !state.session) return;
  const { id, revision } = state.session;
  state.pendingEvent = {
    sessionId: id,
    payload: { eventId: crypto.randomUUID(), revision, action, choice }
  };
  sendPendingEvent();
}

byId('answerForm').addEventListener('change', updateControls);
byId('answerForm').addEventListener('submit', event => {
  event.preventDefault();
  const choice = selectedChoice();
  if (choice) sendEvent('answer', choice);
});
byId('requestHint').addEventListener('click', () => sendEvent('help'));
byId('toggleHelp').addEventListener('click', () => sendEvent('toggle-help'));
byId('startSession').addEventListener('click', () => void runTask(startSession));
byId('publishLesson').addEventListener('click', () => void runTask(publishLesson));
byId('reloadClassroom').addEventListener('click', refreshView);
byId('refreshTeacher').addEventListener('click', refreshView);
byId('retryButton').addEventListener('click', () => {
  const task = state.retry;
  if (!task) return;
  if (task === deliverEvent) sendPendingEvent();
  else void runTask(task);
});
byId('newSession').addEventListener('click', () => {
  state.session = null;
  rememberSession(null);
  showError('');
  render();
  byId('readingTitle').focus();
});
byId('recentSessions').addEventListener('click', event => {
  const button = event.target.closest('button[data-session]');
  if (!button) return;
  state.teacherSelection = button.dataset.session;
  renderReplay();
});
window.addEventListener('hashchange', () => {
  if (location.hash !== '#main') navigate();
});
navigate();
