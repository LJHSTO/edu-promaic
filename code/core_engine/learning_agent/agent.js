import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { expandConceptTool, searchPassagesTool, contrastTool } from './tools.js';
import { focusConceptId, lookupKnowledge } from './knowledge.js';

const stateSchema = Annotation.Root({
  input: Annotation(),
  steps: Annotation({ reducer: (history, events) => [...history, ...events], default: () => [] }),
  tools: Annotation({ reducer: (history, events) => [...history, ...events], default: () => [] }),
  reason: Annotation(),
  policyReason: Annotation(),
  level: Annotation(),
  neighbors: Annotation(),
  passages: Annotation(),
  candidate: Annotation(),
  selectedPassage: Annotation(),
  hint: Annotation(),
  outcome: Annotation()
});

function checkGuard({ input }) {
  const { phase, helpEnabled } = input;
  let reason = null;
  if (phase !== 'practice') reason = 'PROTECTED_ASSESSMENT';
  else if (!helpEnabled) reason = 'USER_OPTED_OUT';
  return { steps: ['guard'], reason, outcome: reason ? 'blocked' : 'pending' };
}

function decide({ input }, engine) {
  const decision = engine.evaluate(input.decisionContext);
  return {
    steps: ['policy'], level: decision.level, policyReason: decision.reasonCode,
    outcome: decision.action === 'INTERVENE' ? 'pending' : 'silent'
  };
}

const teachingQueries = {
  1: '观察依据 自我解释',
  2: '区分点值 附近趋势',
  3: '取值条件 去心邻域',
  4: '因式分解 约去公因式',
  5: '类比例子 类似例题'
};

function queryFor({ memory }, level) {
  const focus = memory.misconception ? '区分点值' : '左右趋势';
  return `${teachingQueries[level]} ${focus}`;
}

async function expand({ input }, expandConcept) {
  try {
    const neighbors = await expandConcept.invoke({ courseVersion: input.courseVersion, conceptId: focusConceptId });
    if (!Array.isArray(neighbors)) throw new TypeError('无效的图谱结果。');
    return { steps: ['memory', 'concept-graph'], tools: [expandConcept.name], neighbors };
  } catch {
    return { steps: ['memory', 'concept-graph'], tools: [expandConcept.name], reason: 'CONCEPT_GRAPH_UNAVAILABLE' };
  }
}

async function retrieve({ input, level, neighbors }, search, broad = false) {
  const related = neighbors[0];
  const query = broad && related ? related.label : queryFor(input, level);
  const steps = [broad ? 'retrieve-related' : 'retrieve'];
  try {
    const passages = await search.invoke({
      query, conceptId: focusConceptId, courseVersion: input.courseVersion, maxLevel: level, limit: 4
    });
    if (!Array.isArray(passages)) throw new TypeError('无效的检索结果。');
    return { steps, tools: [search.name], passages, reason: null };
  } catch {
    return { steps, tools: [search.name], reason: 'KNOWLEDGE_UNAVAILABLE' };
  }
}

const leadIns = {
  1: '先说说你判断的依据。',
  2: '用这个概念再看一次选项。',
  3: '把点上的条件和附近的条件分开写。',
  4: '先写清适用条件，再比较两侧。',
  5: '先完成下面的小比较，再回到练习。'
};

function choosePassage(passages, seenSourceIds) {
  return passages.find(passage => !seenSourceIds.includes(passage.citation.id)) ?? passages[0];
}

function approvedPassage(passage, courseVersion, level, trustPassage) {
  if (typeof passage?.id !== 'string') return null;
  const approved = trustPassage({ id: passage.id, courseVersion });
  if (!approved || approved.level > level || approved.text !== passage.text) return null;
  return approved;
}

async function selectPassage({ input, level, passages }, planner, trustPassage) {
  const { seenSourceIds } = input.memory;
  const usable = passages.map(passage => approvedPassage(passage, input.courseVersion, level, trustPassage)).filter(Boolean);
  const unseen = usable.filter(passage => !seenSourceIds.includes(passage.citation.id));
  const selectedPassage = choosePassage(usable, seenSourceIds) ?? null;
  if (!planner || unseen.length < 2) return { selectedPassage };
  try {
    const id = await planner({ level, passages: unseen });
    const selected = unseen.find(passage => passage.id === id);
    if (selected) return { steps: ['model-rank'], selectedPassage: selected };
  } catch {
    return { steps: ['model-rank', 'rank-locally'], selectedPassage };
  }
  return { steps: ['model-rank', 'rank-locally'], selectedPassage };
}

async function prepareCandidate({ selectedPassage: passage, level }, contrast) {
  if (!passage || level < 4) return { steps: ['compose'], candidate: { passage, example: null } };
  try {
    const example = await contrast.invoke({ pointValue: 3 });
    return { steps: ['compose'], tools: [contrast.name], candidate: { passage, example } };
  } catch {
    return { steps: ['compose'], tools: [contrast.name], candidate: { passage, example: null } };
  }
}

function validateCandidate({ input, candidate, level }, trustPassage) {
  const { passage, example } = candidate;
  const approved = approvedPassage(passage, input.courseVersion, level, trustPassage);
  if (!approved) {
    return { steps: ['validate'], reason: 'CITATION_REJECTED', outcome: 'pending' };
  }
  return {
    steps: ['validate'], outcome: 'grounded',
    hint: {
      level, text: `${leadIns[level]}${approved.text}`, source: approved.citation,
      citations: [approved.citation], example
    }
  };
}

function fallback({ level, reason }, approvedFallback) {
  return {
    steps: ['fallback'], outcome: 'fallback', reason: reason ?? 'NO_APPROVED_PASSAGE',
    hint: approvedFallback(level)
  };
}

function afterRetrieve({ passages }) {
  return passages?.length ? 'rank' : 'retrieve-related';
}

function makeGraph({ engine, approvedFallback, tools, trustPassage, planner }) {
  return new StateGraph(stateSchema)
    .addNode('guard', checkGuard)
    .addNode('policy', state => decide(state, engine))
    .addNode('concept-graph', state => expand(state, tools.expand))
    .addNode('retrieve', state => retrieve(state, tools.search))
    .addNode('retrieve-related', state => retrieve(state, tools.search, true))
    .addNode('rank', state => selectPassage(state, planner, trustPassage))
    .addNode('compose', state => prepareCandidate(state, tools.contrast))
    .addNode('validate', state => validateCandidate(state, trustPassage))
    .addNode('fallback', state => fallback(state, approvedFallback))
    .addEdge(START, 'guard')
    .addConditionalEdges('guard', state => state.outcome === 'pending' ? 'policy' : END)
    .addConditionalEdges('policy', state => state.outcome === 'pending' ? 'concept-graph' : END)
    .addConditionalEdges('concept-graph', state => state.neighbors ? 'retrieve' : 'fallback')
    .addConditionalEdges('retrieve', afterRetrieve)
    .addConditionalEdges('retrieve-related', state => state.passages?.length ? 'rank' : 'fallback')
    .addEdge('rank', 'compose')
    .addEdge('compose', 'validate')
    .addConditionalEdges('validate', state => state.outcome === 'grounded' ? END : 'fallback')
    .addEdge('fallback', END)
    .compile();
}

const liveTools = { expand: expandConceptTool, search: searchPassagesTool, contrast: contrastTool };

export function createLearningAgent({ engine, approvedFallback, tools = liveTools, trustPassage = lookupKnowledge, planner }) {
  const graph = makeGraph({ engine, approvedFallback, tools, trustPassage, planner });
  return async input => {
    const { hint, steps, tools, outcome, reason, policyReason } = await graph.invoke({ input }, { recursionLimit: 12 });
    const sourceIds = hint?.citations?.map(item => item.id) ?? [];
    return {
      hint: hint ?? null,
      trace: {
        outcome, steps, tools, sourceIds, reason: reason ?? policyReason, policyReason: policyReason ?? null,
        memory: { pointValueErrors: input.memory.pointValueErrors, avoidedSources: input.memory.seenSourceIds.length }
      }
    };
  };
}
