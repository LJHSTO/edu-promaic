import { previewSessions, summarizeSessions, filterSessions, toPreviewCsv } from './teacher-preview.js';

const byId = id => document.getElementById(id);
function showView(view) {
  const student = view === 'student';
  byId('studentView').hidden = !student;
  byId('teacherView').hidden = student;
  for (const [id, active] of [['studentNav', student], ['teacherNav', !student]]) {
    byId(id).classList.toggle('active', active);
    if (active) byId(id).setAttribute('aria-current', 'page');
    else byId(id).removeAttribute('aria-current');
  }
  byId(student ? 'workspace' : 'teacherTitle').focus();
}
byId('studentNav').addEventListener('click', () => showView('student'));
byId('teacherNav').addEventListener('click', () => showView('teacher'));
byId('resetSession').addEventListener('click', () => {
  byId('resetConfirmation').hidden = false;
  byId('cancelReset').focus();
});
byId('cancelReset').addEventListener('click', () => {
  byId('resetConfirmation').hidden = true;
  byId('resetSession').focus();
});
byId('confirmReset').addEventListener('click', () => window.location.reload());

let filtered = previewSessions;
let selectedId = previewSessions[0].id;
function renderTimeline() {
  const session = filtered.find(item => item.id === selectedId);
  byId('timelineTitle').textContent = session ? `过程回放 · ${session.id}` : '过程回放';
  byId('timeline').replaceChildren();
  if (!session) return;
  for (const [event, context] of session.events) {
    const li = document.createElement('li');
    const detail = document.createElement('small');
    detail.textContent = context;
    li.append(event, detail);
    byId('timeline').append(li);
  }
}
function renderSessions() {
  filtered = filterSessions(byId('resultFilter').value);
  if (!filtered.some(item => item.id === selectedId)) selectedId = filtered[0]?.id;
  const summary = summarizeSessions(filtered);
  byId('sessionCount').textContent = summary.total;
  byId('firstPassCount').textContent = `${summary.firstPass} / ${summary.attempted}`;
  byId('missingCount').textContent = summary.missing;
  byId('emptySessions').hidden = filtered.length > 0;
  byId('sessionList').replaceChildren(...filtered.map(session => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(session.id === selectedId));
    const detail = document.createElement('small');
    detail.textContent = `${session.supported ? '使用线索' : '未使用线索'} · ${session.resultLabel}`;
    button.append(session.id, detail);
    button.addEventListener('click', () => {
      selectedId = session.id;
      // Keep the focused button in place when switching a replay.
      for (const item of byId('sessionList').children) item.setAttribute('aria-pressed', String(item === button));
      renderTimeline();
    });
    return button;
  }));
  renderTimeline();
}
byId('resultFilter').addEventListener('change', renderSessions);
byId('exportPreview').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob(['\uFEFF', toPreviewCsv(filtered)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'edu-promaic-synthetic-preview.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  byId('exportStatus').textContent = `已导出当前筛选的 ${filtered.length} 个合成会话，不含真实学生数据。`;
});
renderSessions();
