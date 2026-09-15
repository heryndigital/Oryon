import { firebaseConfig } from '/firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, arrayUnion
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const PIPELINE_STAGES = ['Novo', 'Contatado', 'Proposta', 'Negociação', 'Fechado', 'Perdido'];
const PLAN_LABELS = { starter: 'Starter', pro: 'Pro', full: 'Full' };
const DEFAULT_WHATS_TEMPLATE = 'Oi {cliente}! Segue o Pix para pagamento de {valor}, vencimento em {vencimento}.\n\nPix copia e cola:\n{pix}\n\nQualquer dúvida é só chamar por aqui.';

let tenantId = null;
let clients = [], contracts = [], finance = [], pipeline = [], events = [], pipelineStages = PIPELINE_STAGES;
let editingClientId = null, editingContractId = null, editingFinanceId = null, editingProspectId = null, editingEventId = null;
let tenantSettings = null;

// ---- Firestore data helpers (tenant-scoped) ----
function tenantCol(name) { return collection(db, 'tenants', tenantId, name); }
function tenantDocRef(name, id) { return doc(db, 'tenants', tenantId, name, id); }

async function fsList(name) {
  const snap = await getDocs(tenantCol(name));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function fsCreate(name, data) {
  const now = new Date().toISOString();
  const ref = await addDoc(tenantCol(name), { ...data, createdAt: now, updatedAt: now });
  const snap = await getDoc(ref);
  return { id: ref.id, ...snap.data() };
}
async function fsUpdate(name, id, data) {
  const ref = tenantDocRef(name, id);
  await updateDoc(ref, { ...data, updatedAt: new Date().toISOString() });
  const snap = await getDoc(ref);
  return { id: ref.id, ...snap.data() };
}
async function fsAddNote(name, id, text) {
  const ref = tenantDocRef(name, id);
  await updateDoc(ref, { notes: arrayUnion({ text, date: new Date().toISOString() }), updatedAt: new Date().toISOString() });
  const snap = await getDoc(ref);
  return { id: ref.id, ...snap.data() };
}
async function fsDelete(name, id) {
  await deleteDoc(tenantDocRef(name, id));
}

function escapeHtml(str) {
  return (str || '').toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return '—';
  return dt.toLocaleDateString('pt-BR');
}
function clientName(id) {
  const c = clients.find(c => c.id === id);
  return c ? c.name : '—';
}
function clientOptions(selectedId, includeEmpty) {
  let html = includeEmpty ? '<option value="">— Sem cliente vinculado —</option>' : '';
  html += clients.map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  return html;
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
function openModal(id) {
  document.getElementById(id).classList.add('open');
}
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
  overlay.querySelectorAll('[data-close]').forEach(btn => btn.onclick = () => overlay.classList.remove('open'));
});

// ---- Auth / session ----
document.getElementById('logoutBtn').onclick = () => signOut(auth);

// ---- Theme ----
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeToggleLabel').textContent = theme === 'light' ? 'Modo escuro' : 'Modo claro';
}
function initTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem('oryonTheme') || 'dark'; } catch (e) {}
  applyTheme(theme);
}
document.getElementById('themeToggle').onclick = () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem('oryonTheme', next); } catch (e) {}
};
initTheme();

// ---- Nav ----
document.querySelectorAll('.nav-item').forEach(item => {
  item.onclick = () => switchView(item.dataset.view);
});
function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  renderView(view);
}
function renderView(view) {
  if (view === 'dashboard') renderDashboard();
  if (view === 'clients') renderClientsTable();
  if (view === 'contracts') renderContractsTable();
  if (view === 'finance') renderFinanceTable();
  if (view === 'pipeline') renderPipelineBoard();
  if (view === 'events') renderEventsList();
  if (view === 'settings') renderSettings();
}

async function loadAll() {
  [clients, contracts, finance, pipeline, events] = await Promise.all([
    fsList('clients'), fsList('contracts'), fsList('finance'), fsList('pipeline'), fsList('events')
  ]);
}

// ---- Settings ----
async function loadSettings() {
  const snap = await getDoc(tenantDocRef('settings', 'config'));
  tenantSettings = snap.exists() ? snap.data() : { pixKey: '', pixRecipientName: '', pixCity: '', whatsappTemplate: DEFAULT_WHATS_TEMPLATE, schedulerUrl: '' };
  return tenantSettings;
}
function renderSettings() {
  if (!tenantSettings) return;
  document.getElementById('setPixKey').value = tenantSettings.pixKey || '';
  document.getElementById('setPixName').value = tenantSettings.pixRecipientName || '';
  document.getElementById('setPixCity').value = tenantSettings.pixCity || '';
  document.getElementById('setWhatsTemplate').value = tenantSettings.whatsappTemplate || DEFAULT_WHATS_TEMPLATE;
  document.getElementById('setSchedulerUrl').value = tenantSettings.schedulerUrl || '';
}
document.getElementById('setSaveBtn').onclick = async () => {
  const data = {
    pixKey: document.getElementById('setPixKey').value.trim(),
    pixRecipientName: document.getElementById('setPixName').value.trim(),
    pixCity: document.getElementById('setPixCity').value.trim(),
    whatsappTemplate: document.getElementById('setWhatsTemplate').value.trim() || DEFAULT_WHATS_TEMPLATE,
    schedulerUrl: document.getElementById('setSchedulerUrl').value.trim()
  };
  await setDoc(tenantDocRef('settings', 'config'), data);
  tenantSettings = data;
  const msg = document.getElementById('setSavedMsg');
  msg.style.display = 'inline';
  setTimeout(() => { msg.style.display = 'none'; }, 2000);
};
document.getElementById('fGoToSettings').onclick = (e) => {
  e.preventDefault();
  closeModal('financeModal');
  switchView('settings');
};

// ---- Dashboard ----
function computeDashboard() {
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const clientesAtivos = clients.filter(c => c.status === 'ativo').length;
  const mrr = contracts.filter(c => c.status === 'ativo').reduce((sum, c) => sum + (Number(c.valor) || 0), 0);

  const contratosVencendo = contracts.filter(c => {
    if (!c.fim || c.status !== 'ativo') return false;
    const fim = new Date(c.fim);
    return fim >= now && fim <= in30;
  }).sort((a, b) => new Date(a.fim) - new Date(b.fim));

  const pipelineAberto = pipeline.filter(p => p.stage !== 'Fechado' && p.stage !== 'Perdido');
  const pipelineValor = pipelineAberto.reduce((sum, p) => sum + (Number(p.valorEstimado) || 0), 0);

  const financePendente = finance.filter(f => f.status === 'pendente').reduce((s, f) => s + (Number(f.valor) || 0), 0);
  const financeAtrasado = finance.filter(f => f.status === 'pendente' && f.vencimento && new Date(f.vencimento) < now);
  const financeAtrasadoValor = financeAtrasado.reduce((s, f) => s + (Number(f.valor) || 0), 0);

  const proximosEventos = events
    .filter(e => !e.done && e.date && new Date(e.date + 'T' + (e.time || '00:00')) >= new Date(now.toDateString()))
    .sort((a, b) => new Date(a.date + 'T' + (a.time || '00:00')) - new Date(b.date + 'T' + (b.time || '00:00')))
    .slice(0, 8);

  return {
    clientesAtivos, totalClientes: clients.length, mrr, contratosVencendo,
    pipelineAbertoCount: pipelineAberto.length, pipelineValor,
    financePendente, financeAtrasadoCount: financeAtrasado.length, financeAtrasadoValor,
    proximosEventos
  };
}
function renderDashboard() {
  const d = computeDashboard();
  document.getElementById('kpiClientes').textContent = d.clientesAtivos;
  document.getElementById('kpiClientesSub').textContent = d.totalClientes + ' no total';
  document.getElementById('kpiMrr').textContent = fmtMoney(d.mrr);
  document.getElementById('kpiContratos').textContent = d.contratosVencendo.length;
  document.getElementById('kpiPipeline').textContent = d.pipelineAbertoCount;
  document.getElementById('kpiPipelineSub').textContent = fmtMoney(d.pipelineValor) + ' estimado';
  document.getElementById('kpiPendente').textContent = fmtMoney(d.financePendente);
  document.getElementById('kpiAtrasado').textContent = fmtMoney(d.financeAtrasadoValor) + (d.financeAtrasadoCount ? ' (' + d.financeAtrasadoCount + ')' : '');

  const dc = document.getElementById('dashContratos');
  dc.innerHTML = d.contratosVencendo.length ? d.contratosVencendo.map(c => `
    <div class="list-row"><div><div class="name">${escapeHtml(clientName(c.clientId))}</div><div class="meta">${fmtMoney(c.valor)}/mês</div></div><div class="meta">${fmtDate(c.fim)}</div></div>
  `).join('') : '<div class="empty">Nenhum contrato vencendo nos próximos 30 dias.</div>';

  const de = document.getElementById('dashEventos');
  de.innerHTML = d.proximosEventos.length ? d.proximosEventos.map(e => `
    <div class="list-row"><div><div class="name">${escapeHtml(e.title)}</div><div class="meta">${escapeHtml(e.type || '')}</div></div><div class="meta">${fmtDate(e.date)} ${escapeHtml(e.time || '')}</div></div>
  `).join('') : '<div class="empty">Nenhum agendamento futuro.</div>';
}

// ---- Clients ----
function renderClientsTable() {
  const tbody = document.getElementById('clientsTable');
  if (!clients.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);">Nenhum cliente cadastrado ainda.</td></tr>'; return; }
  tbody.innerHTML = clients.map(c => `
    <tr data-id="${c.id}">
      <td>${escapeHtml(c.name)}</td>
      <td><span class="badge badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td>
      <td>${escapeHtml(c.segmento || '—')}</td>
      <td>${escapeHtml(c.responsavel || '—')}</td>
      <td>${escapeHtml(c.contactPhone || c.contactEmail || '—')}</td>
      <td>${fmtDate(c.startDate)}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('tr').forEach(tr => tr.onclick = () => openClientModal(tr.dataset.id));
}
function openClientModal(id) {
  editingClientId = id || null;
  const c = id ? clients.find(x => x.id === id) : null;
  document.getElementById('clientModalTitle').textContent = c ? c.name : 'Novo cliente';
  document.getElementById('cName').value = c ? c.name : '';
  document.getElementById('cStatus').value = c ? c.status : 'ativo';
  document.getElementById('cStartDate').value = c ? c.startDate : '';
  document.getElementById('cSegmento').value = c ? c.segmento : '';
  document.getElementById('cResponsavel').value = c ? c.responsavel : '';
  document.getElementById('cContactName').value = c ? c.contactName : '';
  document.getElementById('cContactPhone').value = c ? c.contactPhone : '';
  document.getElementById('cContactEmail').value = c ? c.contactEmail : '';
  renderClientNotes(c);
  document.getElementById('cDeleteBtn').style.display = c ? 'inline-block' : 'none';
  openModal('clientModal');
}
function renderClientNotes(c) {
  const el = document.getElementById('cNotesList');
  const notes = (c && c.notes) || [];
  el.innerHTML = notes.length ? notes.slice().reverse().map(n => `
    <div class="note-item">${escapeHtml(n.text)}<div class="date">${new Date(n.date).toLocaleString('pt-BR')}</div></div>
  `).join('') : '<div style="color:var(--muted); font-size:12px;">Sem anotações ainda.</div>';
}
document.getElementById('newClientBtn').onclick = () => openClientModal(null);
document.getElementById('cSaveBtn').onclick = async () => {
  const body = {
    name: document.getElementById('cName').value.trim(),
    status: document.getElementById('cStatus').value,
    startDate: document.getElementById('cStartDate').value,
    segmento: document.getElementById('cSegmento').value.trim(),
    responsavel: document.getElementById('cResponsavel').value.trim(),
    contactName: document.getElementById('cContactName').value.trim(),
    contactPhone: document.getElementById('cContactPhone').value.trim(),
    contactEmail: document.getElementById('cContactEmail').value.trim()
  };
  if (!body.name) return alert('Informe o nome do cliente.');
  if (editingClientId) {
    const updated = await fsUpdate('clients', editingClientId, body);
    clients[clients.findIndex(c => c.id === editingClientId)] = updated;
  } else {
    clients.push(await fsCreate('clients', { ...body, notes: [], documents: [] }));
  }
  closeModal('clientModal');
  renderClientsTable();
};
document.getElementById('cAddNoteBtn').onclick = async () => {
  const input = document.getElementById('cNoteInput');
  if (!editingClientId || !input.value.trim()) return;
  const updated = await fsAddNote('clients', editingClientId, input.value.trim());
  clients[clients.findIndex(c => c.id === editingClientId)] = updated;
  input.value = '';
  renderClientNotes(updated);
};
document.getElementById('cDeleteBtn').onclick = async () => {
  if (!confirm('Excluir este cliente? Contratos e cobranças vinculados não serão apagados automaticamente.')) return;
  await fsDelete('clients', editingClientId);
  clients = clients.filter(c => c.id !== editingClientId);
  closeModal('clientModal');
  renderClientsTable();
};

// ---- Contracts ----
function renderContractsTable() {
  const tbody = document.getElementById('contractsTable');
  if (!contracts.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);">Nenhum contrato cadastrado ainda.</td></tr>'; return; }
  tbody.innerHTML = contracts.map(c => `
    <tr data-id="${c.id}">
      <td>${escapeHtml(clientName(c.clientId))}</td>
      <td>${fmtMoney(c.valor)}</td>
      <td>${fmtDate(c.inicio)}</td>
      <td>${fmtDate(c.fim)}</td>
      <td>${c.renovacaoAutomatica ? 'Sim' : 'Não'}</td>
      <td><span class="badge badge-${escapeHtml(c.status)}">${escapeHtml(c.status)}</span></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('tr').forEach(tr => tr.onclick = () => openContractModal(tr.dataset.id));
}
function openContractModal(id) {
  editingContractId = id || null;
  const c = id ? contracts.find(x => x.id === id) : null;
  document.getElementById('contractModalTitle').textContent = c ? clientName(c.clientId) : 'Novo contrato';
  document.getElementById('ctClientId').innerHTML = clientOptions(c ? c.clientId : '', false);
  document.getElementById('ctValor').value = c ? c.valor : '';
  document.getElementById('ctStatus').value = c ? c.status : 'ativo';
  document.getElementById('ctInicio').value = c ? c.inicio : '';
  document.getElementById('ctFim').value = c ? c.fim : '';
  document.getElementById('ctRenovacao').checked = c ? !!c.renovacaoAutomatica : false;
  document.getElementById('ctObs').value = c ? c.observacoes : '';
  document.getElementById('ctDeleteBtn').style.display = c ? 'inline-block' : 'none';
  openModal('contractModal');
}
document.getElementById('newContractBtn').onclick = () => {
  if (!clients.length) return alert('Cadastre um cliente antes de criar um contrato.');
  openContractModal(null);
};
document.getElementById('ctSaveBtn').onclick = async () => {
  const body = {
    clientId: document.getElementById('ctClientId').value,
    valor: Number(document.getElementById('ctValor').value) || 0,
    status: document.getElementById('ctStatus').value,
    inicio: document.getElementById('ctInicio').value,
    fim: document.getElementById('ctFim').value,
    renovacaoAutomatica: document.getElementById('ctRenovacao').checked,
    observacoes: document.getElementById('ctObs').value.trim()
  };
  if (!body.clientId) return alert('Selecione um cliente.');
  if (editingContractId) {
    const updated = await fsUpdate('contracts', editingContractId, body);
    contracts[contracts.findIndex(c => c.id === editingContractId)] = updated;
  } else {
    contracts.push(await fsCreate('contracts', body));
  }
  closeModal('contractModal');
  renderContractsTable();
};
document.getElementById('ctDeleteBtn').onclick = async () => {
  if (!confirm('Excluir este contrato?')) return;
  await fsDelete('contracts', editingContractId);
  contracts = contracts.filter(c => c.id !== editingContractId);
  closeModal('contractModal');
  renderContractsTable();
};

// ---- Finance ----
function renderFinanceTable() {
  const tbody = document.getElementById('financeTable');
  if (!finance.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);">Nenhuma cobrança cadastrada ainda.</td></tr>'; return; }
  const now = new Date();
  tbody.innerHTML = finance.slice().sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || '')).map(f => {
    const atrasado = f.status === 'pendente' && f.vencimento && new Date(f.vencimento) < now;
    const statusLabel = atrasado ? 'atrasado' : f.status;
    return `
    <tr data-id="${f.id}">
      <td>${escapeHtml(f.descricao)}</td>
      <td>${escapeHtml(clientName(f.clientId) === '—' ? '—' : clientName(f.clientId))}</td>
      <td>${fmtMoney(f.valor)}</td>
      <td>${fmtDate(f.vencimento)}</td>
      <td><span class="badge badge-${escapeHtml(statusLabel)}">${escapeHtml(statusLabel)}</span></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach(tr => tr.onclick = () => openFinanceModal(tr.dataset.id));
}
function waPhoneDigits(phone) {
  let digits = (phone || '').toString().replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length <= 11) digits = '55' + digits;
  return digits;
}
function renderChargeBox(f) {
  const box = document.getElementById('fChargeBox');
  const noSettings = document.getElementById('fChargeNoSettings');
  const noPhone = document.getElementById('fChargeNoPhone');
  const ready = document.getElementById('fChargeReady');
  noSettings.style.display = 'none';
  noPhone.style.display = 'none';
  ready.style.display = 'none';

  if (!f) { box.style.display = 'none'; return; }
  box.style.display = 'block';

  if (!tenantSettings || !tenantSettings.pixKey) {
    noSettings.style.display = 'block';
    return;
  }
  const client = f.clientId ? clients.find(c => c.id === f.clientId) : null;
  const phoneDigits = client ? waPhoneDigits(client.contactPhone) : '';
  if (!client || !phoneDigits) {
    noPhone.style.display = 'block';
    return;
  }

  const payload = buildPixPayload({
    key: tenantSettings.pixKey,
    name: tenantSettings.pixRecipientName || 'Recebedor',
    city: tenantSettings.pixCity || 'Sao Paulo',
    amount: f.valor,
    txid: f.id
  });
  document.getElementById('fPixQr').src = pixQrImageUrl(payload, 120);
  document.getElementById('fPixCode').value = payload;

  const message = (tenantSettings.whatsappTemplate || DEFAULT_WHATS_TEMPLATE)
    .replace(/\{cliente\}/g, client.name)
    .replace(/\{valor\}/g, fmtMoney(f.valor))
    .replace(/\{vencimento\}/g, fmtDate(f.vencimento))
    .replace(/\{pix\}/g, payload);
  document.getElementById('fWhatsMsg').value = message;

  document.getElementById('fSendWhatsBtn').onclick = () => {
    const text = encodeURIComponent(document.getElementById('fWhatsMsg').value);
    window.open('https://wa.me/' + phoneDigits + '?text=' + text, '_blank');
  };
  ready.style.display = 'block';
}
document.getElementById('fCopyPixBtn').onclick = async () => {
  const code = document.getElementById('fPixCode');
  code.select();
  try { await navigator.clipboard.writeText(code.value); } catch (e) { document.execCommand('copy'); }
};

function openFinanceModal(id) {
  editingFinanceId = id || null;
  const f = id ? finance.find(x => x.id === id) : null;
  document.getElementById('financeModalTitle').textContent = f ? f.descricao : 'Nova cobrança';
  document.getElementById('fDescricao').value = f ? f.descricao : '';
  document.getElementById('fClientId').innerHTML = clientOptions(f ? f.clientId : '', true);
  document.getElementById('fValor').value = f ? f.valor : '';
  document.getElementById('fVencimento').value = f ? f.vencimento : '';
  document.getElementById('fStatus').value = f ? f.status : 'pendente';
  document.getElementById('fDeleteBtn').style.display = f ? 'inline-block' : 'none';
  renderChargeBox(f);
  openModal('financeModal');
}
document.getElementById('newFinanceBtn').onclick = () => openFinanceModal(null);
document.getElementById('fSaveBtn').onclick = async () => {
  const body = {
    descricao: document.getElementById('fDescricao').value.trim(),
    clientId: document.getElementById('fClientId').value,
    valor: Number(document.getElementById('fValor').value) || 0,
    vencimento: document.getElementById('fVencimento').value,
    status: document.getElementById('fStatus').value
  };
  if (!body.descricao) return alert('Informe a descrição da cobrança.');
  if (body.status === 'pago') body.pagoEm = new Date().toISOString().slice(0, 10);
  if (editingFinanceId) {
    const updated = await fsUpdate('finance', editingFinanceId, body);
    finance[finance.findIndex(f => f.id === editingFinanceId)] = updated;
  } else {
    finance.push(await fsCreate('finance', body));
  }
  closeModal('financeModal');
  renderFinanceTable();
};
document.getElementById('fDeleteBtn').onclick = async () => {
  if (!confirm('Excluir esta cobrança?')) return;
  await fsDelete('finance', editingFinanceId);
  finance = finance.filter(f => f.id !== editingFinanceId);
  closeModal('financeModal');
  renderFinanceTable();
};

// ---- Pipeline (kanban) ----
function renderPipelineBoard() {
  const board = document.getElementById('pipelineBoard');
  board.innerHTML = '';
  pipelineStages.forEach(stage => {
    const items = pipeline.filter(p => p.stage === stage);
    const col = document.createElement('div');
    col.className = 'column';
    col.innerHTML = `
      <div class="column-head"><span>${escapeHtml(stage)}</span><span class="count">${items.length}</span></div>
      <div class="column-body" data-stage="${escapeHtml(stage)}"></div>
    `;
    const body = col.querySelector('.column-body');
    body.addEventListener('dragover', e => { e.preventDefault(); body.classList.add('drag-over'); });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', async e => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const item = pipeline.find(p => p.id === id);
      if (item && item.stage !== stage) {
        item.stage = stage;
        await fsUpdate('pipeline', id, { stage });
        renderPipelineBoard();
      }
    });
    items.forEach(item => body.appendChild(renderProspectCard(item)));
    board.appendChild(col);
  });
}
function renderProspectCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  card.draggable = true;
  card.innerHTML = `
    <div class="name">${escapeHtml(item.name)}</div>
    <div class="meta"><span>${escapeHtml(item.source || '')}</span><span>${item.valorEstimado ? fmtMoney(item.valorEstimado) : ''}</span></div>
  `;
  card.addEventListener('dragstart', e => { card.classList.add('dragging'); e.dataTransfer.setData('text/plain', item.id); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('click', () => openProspectModal(item.id));
  return card;
}
function openProspectModal(id) {
  editingProspectId = id || null;
  const p = id ? pipeline.find(x => x.id === id) : null;
  document.getElementById('prospectModalTitle').textContent = p ? p.name : 'Novo prospect';
  document.getElementById('pName').value = p ? p.name : '';
  document.getElementById('pPhone').value = p ? p.contactPhone : '';
  document.getElementById('pEmail').value = p ? p.contactEmail : '';
  document.getElementById('pSource').value = p ? p.source : '';
  document.getElementById('pValor').value = p ? p.valorEstimado : '';
  document.getElementById('pStage').innerHTML = pipelineStages.map(s => `<option value="${escapeHtml(s)}" ${p && p.stage === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
  renderProspectNotes(p);
  document.getElementById('pDeleteBtn').style.display = p ? 'inline-block' : 'none';
  openModal('prospectModal');
}
function renderProspectNotes(p) {
  const el = document.getElementById('pNotesList');
  const notes = (p && p.notes) || [];
  el.innerHTML = notes.length ? notes.slice().reverse().map(n => `
    <div class="note-item">${escapeHtml(n.text)}<div class="date">${new Date(n.date).toLocaleString('pt-BR')}</div></div>
  `).join('') : '<div style="color:var(--muted); font-size:12px;">Sem anotações ainda.</div>';
}
document.getElementById('newProspectBtn').onclick = () => openProspectModal(null);
document.getElementById('pSaveBtn').onclick = async () => {
  const body = {
    name: document.getElementById('pName').value.trim(),
    contactPhone: document.getElementById('pPhone').value.trim(),
    contactEmail: document.getElementById('pEmail').value.trim(),
    source: document.getElementById('pSource').value.trim(),
    valorEstimado: Number(document.getElementById('pValor').value) || 0,
    stage: document.getElementById('pStage').value
  };
  if (!body.name) return alert('Informe o nome do prospect.');
  if (editingProspectId) {
    const updated = await fsUpdate('pipeline', editingProspectId, body);
    pipeline[pipeline.findIndex(p => p.id === editingProspectId)] = updated;
  } else {
    pipeline.push(await fsCreate('pipeline', { ...body, notes: [] }));
  }
  closeModal('prospectModal');
  renderPipelineBoard();
};
document.getElementById('pAddNoteBtn').onclick = async () => {
  const input = document.getElementById('pNoteInput');
  if (!editingProspectId || !input.value.trim()) return;
  const updated = await fsAddNote('pipeline', editingProspectId, input.value.trim());
  pipeline[pipeline.findIndex(p => p.id === editingProspectId)] = updated;
  input.value = '';
  renderProspectNotes(updated);
};
document.getElementById('pDeleteBtn').onclick = async () => {
  if (!confirm('Excluir este prospect?')) return;
  await fsDelete('pipeline', editingProspectId);
  pipeline = pipeline.filter(p => p.id !== editingProspectId);
  closeModal('prospectModal');
  renderPipelineBoard();
};

// ---- Events ----
function renderEventsList() {
  const el = document.getElementById('eventsList');
  if (!events.length) { el.innerHTML = '<div class="empty">Nenhum agendamento ainda.</div>'; return; }
  const sorted = events.slice().sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  el.innerHTML = sorted.map(e => {
    const dt = new Date(e.date + 'T00:00:00');
    const day = isNaN(dt) ? '--' : dt.getDate();
    const month = isNaN(dt) ? '' : dt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    return `
    <div class="event-row ${e.done ? 'done' : ''}" data-id="${e.id}">
      <div class="date-box"><div class="d">${day}</div><div class="m">${month}</div></div>
      <div class="info">
        <div class="title">${escapeHtml(e.title)}${e.googleEventId ? ' <span style="color:var(--ok); font-size:11px;">· Google Agenda</span>' : ''}</div>
        <div class="meta">${escapeHtml(e.type || '')}${e.clientId ? ' · ' + escapeHtml(clientName(e.clientId)) : ''}${e.time ? ' · ' + escapeHtml(e.time) : ''}</div>
      </div>
    </div>`;
  }).join('');
  el.querySelectorAll('.event-row').forEach(row => row.onclick = () => openEventModal(row.dataset.id));
}
function openEventModal(id) {
  editingEventId = id || null;
  const e = id ? events.find(x => x.id === id) : null;
  document.getElementById('eventModalTitle').textContent = e ? e.title : 'Novo agendamento';
  document.getElementById('eTitle').value = e ? e.title : '';
  document.getElementById('eDate').value = e ? e.date : '';
  document.getElementById('eTime').value = e ? e.time : '';
  document.getElementById('eType').value = e ? e.type : 'Reunião';
  document.getElementById('eClientId').innerHTML = clientOptions(e ? e.clientId : '', true);
  document.getElementById('eNotes').value = e ? e.notes : '';
  document.getElementById('eDone').checked = e ? !!e.done : false;
  document.getElementById('eInviteClient').checked = e ? !!e.googleEventId : false;
  document.getElementById('eInviteStatus').textContent = e && e.googleEventId ? 'Já criado no Google Agenda do cliente.' : '';
  document.getElementById('eDeleteBtn').style.display = e ? 'inline-block' : 'none';
  openModal('eventModal');
}
async function createCalendarInvite(evt, client) {
  const schedulerUrl = tenantSettings && tenantSettings.schedulerUrl;
  if (!schedulerUrl) return { ok: false, reason: 'not-configured' };
  if (!client || !client.contactEmail) return { ok: false, reason: 'no-email' };
  try {
    const res = await fetch(schedulerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        title: evt.title,
        date: evt.date,
        time: evt.time || '09:00',
        durationMinutes: 60,
        guestEmail: client.contactEmail,
        guestName: client.name,
        notes: evt.notes || ''
      })
    });
    const data = await res.json();
    return data.ok ? { ok: true, eventId: data.eventId } : { ok: false, reason: data.error || 'erro' };
  } catch (err) {
    return { ok: false, reason: 'offline' };
  }
}
document.getElementById('newEventBtn').onclick = () => openEventModal(null);
document.getElementById('eSaveBtn').onclick = async () => {
  const body = {
    title: document.getElementById('eTitle').value.trim(),
    date: document.getElementById('eDate').value,
    time: document.getElementById('eTime').value,
    type: document.getElementById('eType').value,
    clientId: document.getElementById('eClientId').value,
    notes: document.getElementById('eNotes').value.trim(),
    done: document.getElementById('eDone').checked
  };
  if (!body.title || !body.date) return alert('Informe título e data.');

  const wantsInvite = document.getElementById('eInviteClient').checked;
  const statusEl = document.getElementById('eInviteStatus');
  let saved;
  if (editingEventId) {
    saved = await fsUpdate('events', editingEventId, body);
    events[events.findIndex(e => e.id === editingEventId)] = saved;
  } else {
    saved = await fsCreate('events', body);
    events.push(saved);
  }

  if (wantsInvite && !saved.googleEventId) {
    const client = clients.find(c => c.id === body.clientId);
    statusEl.textContent = 'Criando evento no Google Agenda...';
    const result = await createCalendarInvite(saved, client);
    if (result.ok) {
      const updated = await fsUpdate('events', saved.id, { googleEventId: result.eventId });
      events[events.findIndex(e => e.id === saved.id)] = updated;
      statusEl.textContent = 'Convite enviado pro Google Agenda do cliente.';
    } else if (result.reason === 'no-email') {
      statusEl.textContent = 'Cadastre um email no cliente pra convidar pelo Google Agenda.';
    } else if (result.reason === 'not-configured') {
      statusEl.textContent = 'Conecte o Google Agenda em Configurações pra habilitar o convite automático.';
    } else {
      statusEl.textContent = 'Não deu pra criar o evento no Google Agenda agora — salvo só no Oryon.';
    }
  }

  closeModal('eventModal');
  renderEventsList();
};
document.getElementById('eDeleteBtn').onclick = async () => {
  if (!confirm('Excluir este agendamento?')) return;
  await fsDelete('events', editingEventId);
  events = events.filter(e => e.id !== editingEventId);
  closeModal('eventModal');
  renderEventsList();
};

// ---- Init (waits for Firebase Auth to resolve) ----
function showFatalError(msg) {
  if (msg) document.getElementById('authFatalMsg').textContent = msg;
  document.getElementById('authFatalError').style.display = 'flex';
}
document.getElementById('authFatalSignupBtn').onclick = async () => {
  await signOut(auth);
  window.location.href = '/signup.html';
};

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = '/login.html'; return; }

  try {
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (!userSnap.exists()) {
      showFatalError('Esse login existe no Firebase, mas não tem uma agência (workspace) associada a ele — geralmente acontece quando o usuário foi criado direto no console do Firebase em vez de pela tela de cadastro do Oryon.');
      return;
    }
    const userData = userSnap.data();
    tenantId = userData.tenantId;

    const tenantSnap = await getDoc(doc(db, 'tenants', tenantId));
    const tenantData = tenantSnap.exists() ? tenantSnap.data() : { name: '—', plan: 'starter' };

    document.getElementById('tenantName').textContent = tenantData.name;
    document.getElementById('userName').textContent = (userData.name || '').split(' ')[0];
    document.getElementById('planLabel').textContent = PLAN_LABELS[tenantData.plan] || tenantData.plan;

    await loadAll();
    await loadSettings();
    switchView('dashboard');
  } catch (err) {
    console.error('Oryon init error:', err);
    showFatalError('Deu erro ao carregar os dados da sua agência (' + (err.code || err.message || 'erro desconhecido') + '). Confira se as regras do Firestore foram publicadas — veja README-DEPLOY.md.');
  }
});
