const problems = {
  practice: {
    title: '练习：极限与函数值',
    stem: '函数在 x ≠ 2 时由下式定义，另规定 f(2) = 1。',
    formula: '<math display="block" aria-label="f(x) 等于 x 的平方减 4，除以 x 减 2"><mi>f</mi><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo><mo>=</mo><mfrac><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn></mrow><mrow><mi>x</mi><mo>−</mo><mn>2</mn></mrow></mfrac></math>',
    question: '当 x 趋近于 2 时，f(x) 的极限是多少？',
    options: [['1', '1'], ['4', '4'], ['none', '极限不存在']],
    answer: '4', pointValue: '1'
  },
  verification: {
    title: '独立验证：换一道题试试',
    stem: '函数在 x ≠ 3 时由下式定义，另规定 g(3) = 7。',
    formula: '<math display="block" aria-label="g(x) 等于 x 的平方减 9，除以 x 减 3"><mi>g</mi><mo stretchy="false">(</mo><mi>x</mi><mo stretchy="false">)</mo><mo>=</mo><mfrac><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>−</mo><mn>9</mn></mrow><mrow><mi>x</mi><mo>−</mo><mn>3</mn></mrow></mfrac></math>',
    question: '当 x 趋近于 3 时，g(x) 的极限是多少？',
    options: [['7', '7'], ['6', '6'], ['none', '极限不存在']],
    answer: '6', pointValue: '7'
  }
};

const hints = {
  1: '你是根据函数在这个点的取值，还是根据附近的变化来判断极限的？先说说你的依据。',
  2: '极限描述的是靠近这个点时的趋势。一个点上单独规定的函数值，不一定改变附近的趋势。',
  3: '分开看两个问题：函数在这个点取什么值？当 x 不等于这个点时，题目中的表达式能怎样整理？',
  4: '先看分子能不能写成两个因式的乘积。约去公因式时，记得检查 x 的取值条件。',
  5: '换一个表达式试试：(t² − 1)/(t − 1)。分子可以写成 (t − 1)(t + 1)。先在 t ≠ 1 时化简，再回到原题检查同样的结构。'
};

const byId = id => document.getElementById(id);
let phase = 'practice';
let consecutiveErrors = 0;
let currentLevel = 0;
let interventionsUsed = 0;
let lastInterventionAt = null;
let userOptedOut = false;
let usedSupportInPractice = false;
let verificationAttempts = 0;
let busy = false;

function updateControls() {
  const protectedPhase = phase !== 'practice';
  const hasHint = Boolean(byId('scaffoldContent').textContent);
  byId('helpBtn').disabled = busy || protectedPhase || userOptedOut;
  byId('muteBtn').disabled = busy || protectedPhase;
  byId('collapseBtn').disabled = busy || protectedPhase || !hasHint || userOptedOut;
  byId('submitBtn').disabled = busy || phase === 'done';
  byId('verifyBtn').disabled = busy;
  byId('muteBtn').textContent = userOptedOut ? '恢复本题提示' : '关闭本题主动提示';
  document.querySelectorAll('input[name="opt"]').forEach(input => { input.disabled = busy || phase === 'done'; });
  byId('answerForm').setAttribute('aria-busy', String(busy));
  updatePhasePresentation(protectedPhase);
}

function updatePhasePresentation(protectedPhase) {
  const sourceNote = document.querySelector('.source-note');
  if (sourceNote) {
    sourceNote.hidden = protectedPhase;
    if (protectedPhase) sourceNote.open = false;
  }
  if (byId('phaseLabel')) {
    byId('phaseLabel').textContent = phase === 'practice' ? '独立尝试' : phase === 'verification' ? '无提示验证' : '本轮完成';
    for (const [id, active] of [['stepPractice', phase === 'practice'], ['stepVerification', phase === 'verification'], ['stepResult', phase === 'done']]) {
      if (active) byId(id).setAttribute('aria-current', 'step');
      else byId(id).removeAttribute('aria-current');
    }
  }
}

function renderProblem() {
  const problem = problems[phase];
  byId('questionTitle').textContent = problem.title;
  byId('stem').textContent = problem.stem;
  byId('formula').innerHTML = problem.formula;
  byId('question').textContent = problem.question;
  byId('options').replaceChildren(...problem.options.map(([value, label], index) => {
    const row = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'opt'; input.value = value;
    row.append(input, ` ${String.fromCharCode(65 + index)}. ${label}`);
    return row;
  }));
  byId('feedback').textContent = '';
  updateControls();
}

function clearHint(message) {
  byId('scaffoldContent').textContent = '';
  byId('scaffoldContent').hidden = true;
  byId('agentStatus').textContent = message;
  byId('collapseBtn').textContent = '收起线索';
}

async function simulateDemoResponse(signal) {
  const control = byId('demoResponse');
  if (!control) return;
  const mode = control.value;
  control.value = 'live';
  if (mode === 'error') throw new Error('评审模拟连接失败');
  if (mode === 'timeout') {
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('评审模拟超时')), { once: true });
    });
  }
  if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 1200));
}

function isValidDecision(data, protectedPhase) {
  if (!data || !['INTERVENE', 'SILENCE'].includes(data.action)) return false;
  if (!Number.isInteger(data.level) || data.level < 0 || data.level > 5) return false;
  if (data.action === 'INTERVENE') return !protectedPhase && Boolean(hints[data.level]);
  return true;
}

async function requestDecision(context, signal) {
  const response = await fetch('/api/decision/evaluate', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(context)
  });
  const result = await response.json();
  if (!response.ok || !result?.success || !isValidDecision(result.data, context.inProtectedAssessment)) {
    throw new Error('无效的决策响应');
  }
  return result.data;
}

function displayDecision(result, requestedHelp) {
  if (result.action === 'SILENCE') {
    byId('agentStatus').textContent = result.reason;
    return;
  }
  currentLevel = result.level;
  lastInterventionAt = Date.now();
  if (!requestedHelp) interventionsUsed++;
  usedSupportInPractice = true;
  byId('agentStatus').textContent = `当前线索：L${currentLevel}`;
  byId('scaffoldContent').textContent = hints[currentLevel];
  byId('scaffoldContent').hidden = false;
  byId('collapseBtn').textContent = '收起线索';
}

async function evaluate({ nextErrors = consecutiveErrors, requestedHelp = false, misconceptionType = null } = {}) {
  const activeElement = document.activeElement;
  busy = true;
  updateControls();
  const previousStatus = byId('agentStatus').textContent;
  byId('agentStatus').textContent = phase === 'verification' ? '正在确认作答，验证阶段不会提供线索…' : '正在检查是否需要线索，请稍候…';
  byId('feedback').removeAttribute('data-error');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    await simulateDemoResponse(controller.signal);
    const result = await requestDecision({
      consecutiveErrors: nextErrors, currentLevel, interventionsUsed, requestedHelp,
      inProtectedAssessment: phase === 'verification', userOptedOut, misconceptionType,
      secondsSinceLastIntervention: lastInterventionAt === null ? null : (Date.now() - lastInterventionAt) / 1000
    }, controller.signal);
    consecutiveErrors = nextErrors;
    displayDecision(result, requestedHelp);
    return true;
  } catch {
    byId('feedback').textContent = '暂时无法连接提示服务，选择已保留。请稍后重试。';
    byId('feedback').setAttribute('data-error', 'true');
    byId('agentStatus').textContent = previousStatus;
    return false;
  } finally {
    clearTimeout(timeout);
    busy = false;
    updateControls();
    if (activeElement instanceof HTMLElement && !activeElement.disabled) {
      activeElement.focus({ preventScroll: true });
    }
  }
}

function finishPractice() {
  consecutiveErrors = 0;
  byId('feedback').textContent = usedSupportInPractice
    ? '这道题做对了。再做一道无提示题，看看能否独立完成。'
    : '这道题独立答对了。可以再做一道题验证一下。';
  byId('practiceResult').textContent = usedSupportInPractice ? '练习：使用线索后完成' : '练习：未使用线索完成';
  byId('verifyBtn').hidden = false;
  byId('submitBtn').hidden = true;
  byId('helpBtn').hidden = true;
}

function finishVerification() {
  verificationAttempts++;
  const firstPass = verificationAttempts === 1;
  byId('feedback').textContent = firstPass
    ? '首次独立验证通过。可以把这次结果作为一条学习记录。'
    : '重试后完成验证。以后再换一道题，检查是否理解得更稳定。';
  byId('verificationResult').textContent = firstPass
    ? '验证：首次独立通过'
    : `验证：第 ${verificationAttempts} 次提交后完成`;
  phase = 'done';
  byId('restartBtn').hidden = false;
  updateControls();
}

function showIncorrectFeedback() {
  if (phase === 'verification') {
    verificationAttempts++;
    byId('feedback').textContent = '这次还不正确，可以再试。验证阶段不提供线索。';
    byId('verificationResult').textContent = '验证：首次未通过，仍在尝试';
  } else {
    byId('feedback').textContent = '这次还不正确，可以重新想一想再提交。';
  }
}

async function submitAnswer(event) {
  event.preventDefault();
  if (busy || phase === 'done') return;
  const selected = document.querySelector('input[name="opt"]:checked');
  if (!selected) {
    byId('feedback').textContent = '先选一个答案，再提交。';
    return;
  }
  byId('feedback').removeAttribute('data-error');
  const problem = problems[phase];
  if (selected.value === problem.answer) {
    if (phase === 'practice') finishPractice();
    else finishVerification();
    return;
  }
  const success = await evaluate({
    nextErrors: consecutiveErrors + 1,
    misconceptionType: selected.value === problem.pointValue ? 'limit_equals_function_value' : null
  });
  if (success) showIncorrectFeedback();
}

byId('answerForm').addEventListener('submit', submitAnswer);
byId('helpBtn').addEventListener('click', () => {
  if (!busy && phase === 'practice' && !userOptedOut) evaluate({ requestedHelp: true });
});
byId('muteBtn').addEventListener('click', () => {
  userOptedOut = !userOptedOut;
  clearHint(userOptedOut ? '本题主动提示已关闭，需要时可以恢复。' : '本题提示已恢复，先继续独立尝试。');
  lastInterventionAt = Date.now();
  updateControls();
});
byId('collapseBtn').addEventListener('click', () => {
  const content = byId('scaffoldContent');
  content.hidden = !content.hidden;
  byId('collapseBtn').textContent = content.hidden ? '展开线索' : '收起线索';
  if (content.hidden) lastInterventionAt = Date.now();
});
byId('verifyBtn').addEventListener('click', () => {
  phase = 'verification';
  consecutiveErrors = 0; currentLevel = 0; interventionsUsed = 0;
  lastInterventionAt = null; userOptedOut = false;
  byId('verifyBtn').hidden = true;
  byId('submitBtn').hidden = false;
  byId('helpBtn').hidden = false;
  clearHint('独立验证中：本题不提供提示。');
  renderProblem();
  byId('questionTitle').focus();
});
byId('restartBtn').addEventListener('click', () => window.location.reload());
renderProblem();
