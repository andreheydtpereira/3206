import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, doc, getDoc, setDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const EMPRESA_ID = "PROMETEON";
const firebaseConfig = {
  apiKey: "AIzaSyCEq8AFWDsJTlJgyGxDP0lKHlpwk-kgjqM",
  authDomain: "gestaopendencias-5a5cc.firebaseapp.com",
  projectId: "gestaopendencias-5a5cc",
  storageBucket: "gestaopendencias-5a5cc.firebasestorage.app",
  messagingSenderId: "657893063824",
  appId: "1:657893063824:web:9c5d960c3cd51011ab6c15"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null, currentTab = "visao", pendencias = [], materiais = [], users = [], planoDia = [];
let selectedMaterial = null, materiaisPendencia = [], pendingProfileCreate = null;

const topoMap = {visao:"topo_visao_geral.png",pendencias:"topo_pendencias.png",materiais:"topo_materiais.png",cadastrar_materiais:"topo_cadastrar_materiais.png",planejamento:"topo_planejamento.png",equipe:"topo_equipe.png",gestor:"topo_configuracao.png",config:"topo_regras.png"};
const menuManutentor = [["visao","Visão Geral","icon_visao_geral.png"],["pendencias","Pendências","icon_pendencias.png"],["materiais","Materiais","icon_materiais.png"],["equipe","Meu Dia","icon_equipe.png"]];
const menuGestor = [["visao","Visão Geral","icon_visao_geral.png"],["pendencias","Pendências","icon_pendencias.png"],["materiais","Materiais","icon_materiais.png"],["cadastrar_materiais","Cadastrar Materiais","icon_cadastrar_materiais.png"],["planejamento","Planejamento","icon_planejamento.png"],["equipe","Equipe","icon_equipe.png"],["gestor","Gestão","icon_configuracao.png"],["config","Regras","icon_regras.png"]];

window.showAuthTab = function(tab){
  document.getElementById("loginPane").classList.toggle("hidden", tab !== "login");
  document.getElementById("cadastroPane").classList.toggle("hidden", tab !== "cadastro");
  document.getElementById("tabLogin").classList.toggle("active", tab === "login");
  document.getElementById("tabCadastro").classList.toggle("active", tab === "cadastro");
  setMsg("");
};
function setMsg(t){ document.getElementById("authMsg").textContent = t || ""; }

function normalizeRole(v){
  if(v === "admin") return "gestor_global";
  return v || "manutentor";
}
function normalizeSetor(v){ return v || ""; }
function normalizeArea(docData){ return docData.area || docData.areaId || docData.areaPadrinhoId || ""; }

function buildCanonicalUser(uid, user, oldData = {}){
  return {
    uid,
    empresaId: oldData.empresaId || EMPRESA_ID,
    nome: oldData.nome || user?.displayName || "Usuário",
    email: oldData.email || user?.email || "",
    role: normalizeRole(oldData.role),
    setor: normalizeSetor(oldData.setor || oldData.setorId || oldData.setorPrincipalId || ""),
    area: normalizeArea(oldData),
    ativo: oldData.ativo !== undefined ? oldData.ativo : (oldData.status === "ativo" ? true : true),
    createdAt: oldData.createdAt || new Date().toISOString()
  };
}


function inferCategoria(texto){
  const t = String(texto || "").toLowerCase();
  if(t.includes("paraf")) return "Fixação";
  if(t.includes("rol")) return "Rolamento";
  if(t.includes("correia")) return "Transmissão";
  if(t.includes("graxa") || t.includes("lub")) return "Lubrificação";
  if(t.includes("sensor")) return "Sensor";
  if(t.includes("contator") || t.includes("fus")) return "Elétrica";
  if(t.includes("válvula") || t.includes("mangueira") || t.includes("pneu")) return "Pneumática";
  return "Geral";
}
function parseMaterial(raw){
  const nome = raw.nome || "";
  const parts = nome.split("—");
  const codigo = (raw.codigo || parts[0] || "").trim();
  const descricao = (raw.descricao || parts.slice(1).join("—") || nome).trim();
  const categoria = raw.categoria || inferCategoria(nome);
  return { ...raw, codigo, descricao, categoria, nome };
}
function normalizeTerm(s){
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function materialScore(material, busca){
  const q = normalizeTerm(busca);
  if(!q) return 0;
  const codigo = normalizeTerm(material.codigo);
  const desc = normalizeTerm(material.descricao);
  const cat = normalizeTerm(material.categoria);
  let score = 0;
  if(codigo === q) score += 100;
  if(codigo.startsWith(q)) score += 60;
  if(codigo.includes(q)) score += 40;
  if(desc.includes(q)) score += 25;
  if(cat.includes(q)) score += 10;
  for(const tok of q.split(/\s+/).filter(Boolean)){
    if(codigo.includes(tok)) score += 15;
    if(desc.includes(tok)) score += 10;
    if(cat.includes(tok)) score += 5;
  }
  return score;
}
function categoriasDisponiveis(){
  const set = new Set(materiais.map(m => parseMaterial(m).categoria));
  return ["TODOS", ...Array.from(set).sort()];
}
function filtrarMateriaisMotor(busca, categoria){
  let list = materiais.map(parseMaterial);
  if(categoria && categoria !== "TODOS") list = list.filter(m => m.categoria === categoria);
  if(busca && busca.trim()){
    list = list.map(m => ({...m, _score: materialScore(m, busca)})).filter(m => m._score > 0).sort((a,b) => b._score - a._score || a.codigo.localeCompare(b.codigo));
  } else {
    list = list.sort((a,b) => a.codigo.localeCompare(b.codigo));
  }
  return list.slice(0, 30);
}
function materialJaAdicionado(id){ return materiaisPendencia.findIndex(x => x.id === id); }
function renderMaterialResults(prefix, allowAdd){
  const busca = document.getElementById(`${prefix}Busca`)?.value || "";
  const categoria = document.getElementById(`${prefix}Categoria`)?.value || "TODOS";
  const box = document.getElementById(`${prefix}Resultados`);
  if(!box) return;
  const results = filtrarMateriaisMotor(busca, categoria);
  if(!results.length){
    box.innerHTML = `<div class="list-item">Nenhum material encontrado. Cadastre materiais ou gere cenário industrial.</div>`;
    return;
  }
  box.innerHTML = results.map(m => `
    <div class="material-row">
      <div class="material-code">${esc(m.codigo)}</div>
      <span class="material-desc">${esc(m.descricao)}</span>
      <div class="material-meta">Categoria: ${esc(m.categoria)}</div>
      ${allowAdd ? `<div class="row"><button class="small-btn secondary" onclick="adicionarMaterialPend('${esc(m.id)}')">Adicionar</button></div>` : ``}
    </div>
  `).join("");
}
window.adicionarMaterialPend = function(id){
  const qtd = Math.max(1, Number(document.getElementById("pendQtd")?.value || 1));
  const m = materiais.map(parseMaterial).find(x => x.id === id);
  if(!m) return alert("Material não encontrado.");
  const idx = materialJaAdicionado(id);
  if(idx >= 0) materiaisPendencia[idx].quantidade += qtd;
  else materiaisPendencia.push({ id:m.id, codigo:m.codigo, descricao:m.descricao, categoria:m.categoria, quantidade:qtd });
  renderListaMateriaisPendencia();
};
window.alterarQtdPend = function(i, delta){
  materiaisPendencia[i].quantidade = Math.max(1, Number(materiaisPendencia[i].quantidade || 1) + delta);
  renderListaMateriaisPendencia();
};

window.registrar = async function(){
  try{
    setMsg("Cadastrando...");
    const nome = document.getElementById("cadNome").value.trim();
    const email = document.getElementById("cadEmail").value.trim();
    const senha = document.getElementById("cadSenha").value;
    const role = document.getElementById("cadRole").value;
    const setor = document.getElementById("cadSetor").value.trim();
    const area = document.getElementById("cadArea").value.trim();
    if(!nome || !email || !senha) throw new Error("Preencha nome, email e senha.");
    if(role === "manutentor" && (!setor || !area)) throw new Error("Manutentor precisa de setor e área.");
    pendingProfileCreate = { empresaId: EMPRESA_ID, nome, email, role, setor: setor || "", area: area || "" };
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    await updateProfile(cred.user, { displayName: nome });
    setMsg("Usuário criado. Finalizando perfil...");
  }catch(e){
    if(String(e.message || "").includes("email-already-in-use")){
      setMsg("Este email já existe. Use Login. Se o perfil estiver incompleto, o sistema vai tentar padronizar após o login.");
      return;
    }
    setMsg(e.message || "Falha no cadastro.");
  }
};

window.login = async function(){
  try{
    const email = document.getElementById("loginEmail").value.trim();
    const senha = document.getElementById("loginSenha").value;
    if(!email || !senha) throw new Error("Preencha email e senha.");
    setMsg("Entrando...");
    await signInWithEmailAndPassword(auth, email, senha);
  }catch(e){ setMsg(e.message || "Falha no login."); }
};

window.logout = async function(){ await signOut(auth); };

onAuthStateChanged(auth, async (user) => {
  if(!user){
    document.getElementById("authView").classList.remove("hidden");
    document.getElementById("appView").classList.add("hidden");
    currentUser = null;
    return;
  }
  try{
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if(pendingProfileCreate && pendingProfileCreate.email === user.email){
      if(!snap.exists()){
        await setDoc(ref, {
          uid:user.uid, empresaId:EMPRESA_ID, nome:pendingProfileCreate.nome, email:pendingProfileCreate.email,
          role:pendingProfileCreate.role, setor:pendingProfileCreate.setor, area:pendingProfileCreate.area,
          ativo:true, createdAt:new Date().toISOString()
        });
      } else {
        const canonical = buildCanonicalUser(user.uid, user, snap.data());
        await updateDoc(ref, canonical);
      }
      pendingProfileCreate = null;
    } else {
      if(!snap.exists()){
        await setDoc(ref, {
          uid:user.uid, empresaId:EMPRESA_ID, nome:user.displayName || "Usuário", email:user.email || "",
          role:"manutentor", setor:"", area:"", ativo:true, createdAt:new Date().toISOString()
        });
      } else {
        const oldData = snap.data();
        const canonical = buildCanonicalUser(user.uid, user, oldData);
        const needsMigration =
          oldData.empresaId !== canonical.empresaId ||
          oldData.role !== canonical.role ||
          oldData.setor !== canonical.setor ||
          oldData.area !== canonical.area ||
          oldData.ativo !== canonical.ativo ||
          oldData.status !== undefined ||
          oldData.setorId !== undefined ||
          oldData.setorPrincipalId !== undefined ||
          oldData.areaPadrinhoId !== undefined;
        if(needsMigration) await updateDoc(ref, canonical);
      }
    }

    const finalSnap = await getDoc(ref);
    currentUser = finalSnap.data();

    if(currentUser.empresaId !== EMPRESA_ID){
      await signOut(auth);
      setMsg("Usuário não pertence à empresa configurada.");
      return;
    }

    document.getElementById("authView").classList.add("hidden");
    document.getElementById("appView").classList.remove("hidden");
    document.getElementById("usuarioLabel").textContent = `${currentUser.nome} • ${currentUser.role}`;
    document.getElementById("btnMigrar").classList.toggle("hidden", currentUser.role !== "gestor_global");
    document.getElementById("btnGerarCenario").classList.toggle("hidden", !(currentUser.role === "gestor" || currentUser.role === "gestor_global"));
    buildMenu();
    await preload();
    render();
    setTimeout(centerActiveMenu, 80);
  }catch(e){
    await signOut(auth);
    setMsg(e.message || "Falha ao carregar usuário.");
  }
});

function centerActiveMenu(){
  const active = document.querySelector("#menuCarousel .item.active");
  if(active) active.scrollIntoView({behavior:"smooth", inline:"center", block:"nearest"});
}
function buildMenu(){
  const items = (currentUser.role === "gestor" || currentUser.role === "gestor_global") ? menuGestor : menuManutentor;
  const menu = document.getElementById("menuCarousel");
  menu.innerHTML = items.map(([key,label,icon]) => `<div class="item ${key===currentTab ? "active" : ""}" onclick="openTab(\'${key}\')" title="${label}"><img src="${icon}" alt="${label}"></div>`).join("") + `<div class="item" onclick="logout()" title="Sair"><img src="icon_regras.png" alt="Sair"></div>`;
}

window.openTab = function(tab){ currentTab = tab; buildMenu(); render(); setTimeout(centerActiveMenu, 50); };

async function preload(){ await Promise.all([loadPendencias(), loadMateriais(), loadUsers()]); }
async function loadPendencias(){ pendencias=[]; const snap=await getDocs(collection(db,"empresas",EMPRESA_ID,"pendencias")); snap.forEach(d=>pendencias.push({id:d.id,...d.data()})); }
async function loadMateriais(){ materiais=[]; const snap=await getDocs(collection(db,"empresas",EMPRESA_ID,"materiais")); snap.forEach(d=>materiais.push({id:d.id,...d.data()})); }
async function loadUsers(){ users=[]; const snap=await getDocs(query(collection(db,"users"),where("empresaId","==",EMPRESA_ID))); snap.forEach(d=>users.push({id:d.id,...d.data()})); }

window.migrarModeloAntigo = async function(){
  if(currentUser?.role !== "gestor_global") return alert("Apenas gestor_global pode migrar.");
  const before = users.length;
  let migrated = 0;
  for(const u of users){
    const canonical = buildCanonicalUser(u.uid || u.id, null, u);
    const needsMigration =
      u.empresaId !== canonical.empresaId ||
      u.role !== canonical.role ||
      u.setor !== canonical.setor ||
      u.area !== canonical.area ||
      u.ativo !== canonical.ativo ||
      u.status !== undefined ||
      u.setorId !== undefined ||
      u.setorPrincipalId !== undefined ||
      u.areaPadrinhoId !== undefined;
    if(needsMigration){
      await updateDoc(doc(db, "users", u.id), canonical);
      migrated++;
    }
  }
  await loadUsers();
  if(currentTab === "gestor") renderGestor(); else renderConfig();
  alert(`Migração concluída. Usuários verificados: ${before}. Usuários migrados: ${migrated}.`);
};

window.gerarCenarioIndustrial = async function(){
  if(!(currentUser?.role === "gestor" || currentUser?.role === "gestor_global")) {
    return alert("Apenas gestor ou gestor_global pode gerar cenário.");
  }

  const matsRef = collection(db, "empresas", EMPRESA_ID, "materiais");
  const pendRef = collection(db, "empresas", EMPRESA_ID, "pendencias");

  const materiaisBase = [{codigo:"PAR-M8X30",descricao:"Parafuso sextavado M8 x 30",categoria:"Fixação"},{codigo:"PAR-M10X50",descricao:"Parafuso Allen M10 x 50",categoria:"Fixação"},{codigo:"ROL-6205",descricao:"Rolamento 6205",categoria:"Rolamento"},{codigo:"COR-AX32",descricao:"Correia AX32",categoria:"Transmissão"},{codigo:"LUB-EP2",descricao:"Graxa EP2",categoria:"Lubrificação"},{codigo:"SEN-PROX-12V",descricao:"Sensor proximidade 12V",categoria:"Sensor"},{codigo:"CONT-3RT",descricao:"Contator 3RT",categoria:"Elétrica"},{codigo:"FUS-10A",descricao:"Fusível 10A",categoria:"Elétrica"},{codigo:"VAL-PNEU-1/4",descricao:"Válvula pneumática 1/4",categoria:"Pneumática"},{codigo:"MANG-8MM",descricao:"Mangueira pneumática 8mm",categoria:"Pneumática"}];

  const pendenciasBase = [
    {titulo:"Troca de sensor da cortadeira", maquina:"CTB1", setor:"UPGR", area:"Cortadeiras", criticidade:"alta", tipo:"seguranca", tempoExec:2, tempoPrep:0.5, esforco:"leve", status:"aberta", materiais:["SEN-PROX-12V","FUS-10A"]},
    {titulo:"Ajuste de alinhamento na confecção", maquina:"LCG1", setor:"UPA", area:"Confecção", criticidade:"media", tipo:"qualidade", tempoExec:3, tempoPrep:1, esforco:"medio", status:"em_atendimento", materiais:["PAR-M8X30","LUB-EP2"]},
    {titulo:"Troca de correia da mono", maquina:"MONO2", setor:"UPGR", area:"Frisos", criticidade:"alta", tipo:"producao", tempoExec:4, tempoPrep:1, esforco:"pesado", status:"aberta", materiais:["COR-AX32","PAR-M10X50"]},
    {titulo:"Substituição de rolamento", maquina:"TTM90", setor:"UPGR", area:"Cortadeiras", criticidade:"alta", tipo:"producao", tempoExec:5, tempoPrep:1, esforco:"pesado", status:"aguardando_material", materiais:["ROL-6205","LUB-EP2"]},
    {titulo:"Reparo em válvula pneumática", maquina:"DELTAX1", setor:"UPGR", area:"Frisos", criticidade:"media", tipo:"qualidade", tempoExec:2.5, tempoPrep:0.5, esforco:"medio", status:"aberta", materiais:["VAL-PNEU-1/4","MANG-8MM"]},
    {titulo:"Fixação de proteção mecânica", maquina:"LCZ2", setor:"UPA", area:"Confecção", criticidade:"alta", tipo:"seguranca", tempoExec:1.5, tempoPrep:0.5, esforco:"leve", status:"maquina_parada", materiais:["PAR-M8X30","PAR-M10X50"]},
    {titulo:"Troca de contator do painel", maquina:"VMI", setor:"UPGR", area:"Cortadeiras", criticidade:"media", tipo:"producao", tempoExec:2, tempoPrep:1, esforco:"medio", status:"aberta", materiais:["CONT-3RT","FUS-10A"]},
    {titulo:"Inspeção e reaperto estrutural", maquina:"4T2", setor:"UPA", area:"Confecção", criticidade:"baixa", tipo:"qualidade", tempoExec:2, tempoPrep:0.5, esforco:"leve", status:"aberta", materiais:["PAR-M8X30"]},
    {titulo:"Substituição de mangueira pneumática", maquina:"TST1", setor:"UPGR", area:"Frisos", criticidade:"media", tipo:"producao", tempoExec:1.5, tempoPrep:0.5, esforco:"leve", status:"aberta", materiais:["MANG-8MM","VAL-PNEU-1/4"]},
    {titulo:"Limpeza técnica e lubrificação", maquina:"LCZ4", setor:"UPA", area:"Confecção", criticidade:"baixa", tipo:"qualidade", tempoExec:1, tempoPrep:0.5, esforco:"leve", status:"em_atendimento", materiais:["LUB-EP2"]}
  ];

  for(const m of materiaisBase){ await addDoc(matsRef, { nome:`${m.codigo} — ${m.descricao}`, codigo:m.codigo, descricao:m.descricao, categoria:m.categoria, createdAt:new Date().toISOString(), seed:true }); }

  for(const p of pendenciasBase){
    await addDoc(pendRef, {
      titulo:p.titulo,
      maquina:p.maquina,
      setor:p.setor,
      area:p.area,
      criticidade:p.criticidade,
      tipo:p.tipo,
      tempoExec:p.tempoExec,
      tempoPrep:p.tempoPrep,
      esforco:p.esforco,
      status:p.status,
      maquinaParada:p.status === "maquina_parada",
      descricao:`Cenário industrial gerado automaticamente para ${p.maquina}.`,
      materiais:p.materiais.map(nome => ({ nome })),
      execucao:"nao_iniciada",
      createdBy:currentUser.uid,
      createdAt:new Date().toISOString(),
      seed:true
    });
  }

  await preload();
  render();
  alert("Cenário industrial gerado com sucesso.");
};

function esc(v){ return String(v ?? "").replace(/[&<>"]/g, s => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[s])); }
function badge(v){ return `<span class="badge">${esc(v)}</span>`; }
function criticidadePeso(v){ if(v==="alta") return 3; if(v==="media") return 2; return 1; }
function tipoPeso(v){ if(v==="seguranca") return 6; if(v==="qualidade") return 5; if(v==="producao") return 4; return 0; }
function esforcoPeso(v){ if(v==="pesado") return 1.5; if(v==="medio") return 1.2; return 1; }
function statusSafe(v){ const map={aberta:"Aberta",aguardando_material:"Aguardando material",em_atendimento:"Em atendimento",aguardando_parada:"Aguardando parada",maquina_parada:"Máquina parada",nao_iniciada:"Não iniciada",em_andamento:"Em andamento",concluido:"Concluído"}; return map[v] || v || "-"; }
function statusBloqueado(v){ return ["aguardando_material","aguardando_parada"].includes(v); }
function tempoReal(p){ const exec=Number(p.tempoExec||1); const prep=Number(p.tempoPrep||0); return (exec+prep) * esforcoPeso(p.esforco || "leve"); }
function prioridadeTotal(p){ let x = criticidadePeso(p.criticidade || "baixa") + tipoPeso(p.tipo || ""); if(p.maquinaParada || p.status==="maquina_parada") x += 10; return x; }
function pendenciasPorPerfil(){ if(currentUser.role==="gestor" || currentUser.role==="gestor_global") return pendencias; return pendencias.filter(p=>p.setor===currentUser.setor && p.area===currentUser.area); }

function render(){
  document.getElementById("topImage").src = topoMap[currentTab] || "topo_visao_geral.png";
  if(currentTab==="visao") return renderVisao();
  if(currentTab==="pendencias") return renderPendencias();
  if(currentTab==="materiais") return renderMateriais();
  if(currentTab==="cadastrar_materiais") return renderCadastrarMateriais();
  if(currentTab==="planejamento") return renderPlanejamento();
  if(currentTab==="equipe") return renderEquipe();
  if(currentTab==="gestor") return renderGestor();
  if(currentTab==="config") return renderConfig();
}

function renderVisao(){
  const list = pendenciasPorPerfil();
  const abertas = list.filter(x=>x.status==="aberta").length;
  const agMat = list.filter(x=>x.status==="aguardando_material").length;
  const emAt = list.filter(x=>x.status==="em_atendimento").length;
  document.getElementById("cardCentral").innerHTML = `
    <div class="home-hero">
      <img src="home_abertura.png" alt="Manutenção Prometeon">
    </div>
    <div class="kpis">
      <div class="kpi"><div class="num">${list.length}</div><div>Pendências</div></div>
      <div class="kpi"><div class="num">${abertas}</div><div>Abertas</div></div>
      <div class="kpi"><div class="num">${agMat}</div><div>Aguardando material</div></div>
      <div class="kpi"><div class="num">${emAt}</div><div>Em atendimento</div></div>
    </div>
    <div class="module-panel">${list.length ? list.map(p=>`<div class="list-item"><strong>${esc(p.titulo)}</strong><br>${badge(p.setor || "-")} ${badge(p.area || "-")} ${badge(p.maquina || "-")} ${badge(statusSafe(p.status))}<div class="muted">Criticidade: ${esc(p.criticidade || "-")} • Tipo: ${esc(p.tipo || "-")} • Tempo real: ${tempoReal(p).toFixed(1)}h</div></div>`).join("") : `<div class="list-item">Sem pendências.</div>`}</div>`;
}

function renderPendencias(){
  materiaisPendencia=[]; selectedMaterial=null;
  document.getElementById("cardCentral").innerHTML = `
    <div class="progress-wrap">
      <div class="progress-bar">
        <div class="progress-step">1. Local</div>
        <div class="progress-step">2. Atividade</div>
        <div class="progress-step">3. Prioridade</div>
        <div class="progress-step">4. Execução</div>
        <div class="progress-step">5. Status</div>
        <div class="progress-step">6. Materiais</div>
      </div>
    </div>

    <div class="step-card">
      <div class="step-head"><div class="step-num">1</div><strong>Local da atividade</strong></div>
      <select id="pSetor"><option value="">Selecione o setor</option><option value="UPA">UPA</option><option value="UPGR">UPGR</option></select>
      <div class="hint">Escolha o setor onde a atividade será realizada.</div>
      <select id="pArea"><option value="">Selecione a área</option><option value="Confecção">Confecção</option><option value="Cortadeiras">Cortadeiras</option><option value="Frisos">Frisos</option></select>
      <div class="hint">Escolha a área responsável pela execução.</div>
      <input id="pMaquina" placeholder="Ex: CTB1, LCG2, MONO2">
      <div class="hint">Informe a máquina ou equipamento onde está a pendência.</div>
    </div>

    <div class="step-card">
      <div class="step-head"><div class="step-num">2</div><strong>Atividade</strong></div>
      <input id="pTitulo" placeholder="Ex: Troca de rolamento da CTB1">
      <div class="hint">Use um nome curto e objetivo para identificar a atividade.</div>
      <textarea id="pDesc" placeholder="Ex: Rolamento com ruído e aquecimento acima do normal. Necessário substituir e alinhar conjunto."></textarea>
      <div class="hint">Descreva o problema encontrado e o que precisa ser executado.</div>
    </div>

    <div class="step-card">
      <div class="step-head"><div class="step-num">3</div><strong>Prioridade</strong></div>
      <select id="pCriticidade"><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select>
      <div class="hint">Defina o impacto da pendência no processo.</div>
      <select id="pTipo"><option value="seguranca">Segurança</option><option value="qualidade">Qualidade</option><option value="producao">Produção</option><option value="outra">Outra</option></select>
      <div class="hint">Classifique a pendência conforme o motivo principal.</div>
    </div>

    <div class="step-card">
      <div class="step-head"><div class="step-num">4</div><strong>Execução</strong></div>
      <input id="pTempoExec" placeholder="Ex: 2">
      <div class="hint">Informe quantas horas a execução deve consumir.</div>
      <input id="pTempoPrep" placeholder="Ex: 0.5">
      <div class="hint">Informe o tempo necessário antes de iniciar a atividade.</div>
      <select id="pEsforco"><option value="leve">Leve</option><option value="medio">Médio</option><option value="pesado">Pesado</option></select>
      <div class="hint">Defina o esforço físico esperado para essa atividade.</div>
    </div>

    <div class="step-card">
      <div class="step-head"><div class="step-num">5</div><strong>Status inicial</strong></div>
      <select id="pStatus"><option value="aberta">Aberta</option><option value="aguardando_material">Aguardando material</option><option value="em_atendimento">Em atendimento</option><option value="aguardando_parada">Aguardando parada</option><option value="maquina_parada">Máquina parada</option></select>
      <div class="hint">Selecione a situação atual da atividade no momento do cadastro.</div>
    </div>

    <div class="step-card">
      <div class="step-head"><div class="step-num">6</div><strong>Materiais</strong></div>
      <div class="section-title">Busca inteligente + filtro técnico</div>
      <div class="grid-3">
        <input id="pendBusca" placeholder="Buscar por código, descrição ou termo técnico">
        <select id="pendCategoria"></select>
        <input id="pendQtd" class="qty-box" type="number" min="1" step="1" value="1" placeholder="Qtd">
      </div>
      <div class="hint">Exemplos: paraf, m8, rol 6205, sensor 12v, pneumática.</div>
      <div id="pendResultados"></div>
      <div class="section-title">Materiais vinculados à pendência</div>
      <div id="listaMateriaisPendencia"></div>
    </div>

    <div class="module-panel"><button id="btnSalvarPendencia">Salvar pendência</button></div>`;
  const sel = document.getElementById("pendCategoria");
  sel.innerHTML = categoriasDisponiveis().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  document.getElementById("pendBusca").addEventListener("input", () => renderMaterialResults("pend", true));
  document.getElementById("pendCategoria").addEventListener("change", () => renderMaterialResults("pend", true));
  document.getElementById("btnSalvarPendencia").addEventListener("click", salvarPendencia);
  renderMaterialResults("pend", true);
  renderListaMateriaisPendencia();
}
function renderBuscaMaterialPendencia(){
  const q=(document.getElementById("mBuscaPend").value || "").toLowerCase().trim();
  const filtrados = materiais.filter(m => !q || (m.nome || "").toLowerCase().includes(q));
  document.getElementById("mBuscaPendRes").innerHTML = filtrados.length ? filtrados.map(m=>`<div class="list-item" data-mid="${m.id}"><strong>${esc(m.nome)}</strong></div>`).join("") : `<div class="list-item">Sem materiais cadastrados.</div>`;
  document.querySelectorAll("[data-mid]").forEach(el => el.addEventListener("click", ()=>{ document.querySelectorAll("[data-mid]").forEach(x=>x.style.outline="none"); el.style.outline="2px solid #7ab0ff"; selectedMaterial = materiais.find(m=>m.id===el.getAttribute("data-mid")) || null; }));
}
function addMaterialNaPendencia(){ if(!selectedMaterial) return alert("Selecione um material."); materiaisPendencia.push({id:selectedMaterial.id,nome:selectedMaterial.nome}); renderListaMateriaisPendencia(); }
function renderListaMateriaisPendencia(){
  const box=document.getElementById("listaMateriaisPendencia");
  if(!box) return;
  if(!materiaisPendencia.length){
    box.innerHTML = `<div class="list-item">Nenhum material adicionado.</div>`;
    return;
  }
  box.innerHTML = materiaisPendencia.map((m,i)=>`<div class="material-added"><div class="material-code">${esc(m.codigo)} • Qtd: ${esc(m.quantidade)}</div><span class="material-desc">${esc(m.descricao)}</span><div class="material-meta">Categoria: ${esc(m.categoria)}</div><div class="row"><button class="small-btn" onclick="alterarQtdPend(${i}, -1)">-1</button><button class="small-btn" onclick="alterarQtdPend(${i}, 1)">+1</button><button class="small-btn secondary" onclick="remMatPend(${i})">Remover</button></div></div>`).join("");
}
function renderMateriais(){
  document.getElementById("cardCentral").innerHTML = `
    <div class="module-panel">
      <div class="section-title">Consulta inteligente de materiais</div>
      <div class="grid-3">
        <input id="matBusca" placeholder="Buscar por código, descrição ou termo técnico">
        <select id="matCategoria"></select>
        <div class="hint">Consulta técnica</div>
      </div>
      <div class="hint">Use esta função apenas para localizar materiais. O cadastro fica em "Cadastrar".</div>
      <div id="matResultados"></div>
    </div>`;
  const sel = document.getElementById("matCategoria");
  sel.innerHTML = categoriasDisponiveis().map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  document.getElementById("matBusca").addEventListener("input", () => renderMaterialResults("mat", false));
  document.getElementById("matCategoria").addEventListener("change", () => renderMaterialResults("mat", false));
  renderMaterialResults("mat", false);
}

function renderCadastrarMateriais(){
  if(!(currentUser.role==="gestor" || currentUser.role==="gestor_global")){
    document.getElementById("cardCentral").innerHTML = `<div class="module-panel"><div class="muted">Apenas gestor ou gestor_global podem cadastrar materiais.</div></div>`;
    return;
  }
  document.getElementById("cardCentral").innerHTML = `
    <div class="module-hero">
      <div class="section-title">Cadastrar Materiais</div>
      <div class="hint">Esta função é exclusiva para alimentar a base de materiais. A consulta técnica permanece na função "Materiais".</div>
    </div>

    <div class="module-panel">
      <div class="section-title">Cadastro manual por texto</div>
      <input id="novoCodigo" placeholder="Código. Ex: PAR-M8X30">
      <div class="hint">Informe o código técnico do material.</div>
      <input id="novoDescricao" placeholder="Descrição. Ex: Parafuso sextavado M8 x 30">
      <div class="hint">Informe a descrição completa do material.</div>
      <input id="novaCategoria" placeholder="Categoria. Ex: Fixação">
      <div class="hint">Categoria técnica usada no filtro inteligente.</div>
      <button id="btnNovoMaterial">Cadastrar material</button>
    </div>

    <div class="module-panel">
      <div class="section-title">Importação por CSV</div>
      <textarea id="csvMateriais" placeholder="codigo,descricao,categoria&#10;PAR-M8X30,Parafuso sextavado M8 x 30,Fixação&#10;ROL-6205,Rolamento 6205,Rolamento"></textarea>
      <div class="hint">Formato: codigo, descricao, categoria. Uma linha por material.</div>
      <button id="btnImportarCSV">Importar CSV</button>
      <div class="upload-note">Use esta área apenas para cadastramento em lote. Materiais importados passam a aparecer imediatamente em Materiais e Pendências.</div>
    </div>`;
  document.getElementById("btnNovoMaterial").addEventListener("click", salvarMaterial);
  document.getElementById("btnImportarCSV").addEventListener("click", importarCSV);
}

async function salvarMaterial(){
  const codigo=document.getElementById("novoCodigo")?.value.trim() || "";
  const descricao=document.getElementById("novoDescricao")?.value.trim() || "";
  const categoria=(document.getElementById("novaCategoria")?.value.trim() || "") || inferCategoria(`${codigo} ${descricao}`);
  if(!codigo || !descricao) return alert("Informe código e descrição.");
  await addDoc(collection(db,"empresas",EMPRESA_ID,"materiais"), { nome:`${codigo} — ${descricao}`, codigo, descricao, categoria, createdAt:new Date().toISOString() });
  await loadMateriais(); renderCadastrarMateriais();
}
async function importarCSV(){
  const raw = (document.getElementById("csvMateriais")?.value || "").trim();
  if(!raw) return alert("Cole o conteúdo CSV.");
  const linhas = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if(linhas.length < 2) return alert("Informe cabeçalho e ao menos uma linha.");
  const cab = linhas[0].toLowerCase();
  if(!cab.includes("codigo") || !cab.includes("descricao")) return alert("Cabeçalho esperado: codigo,descricao,categoria");
  let count = 0;
  for(const linha of linhas.slice(1)){
    const cols = linha.split(",").map(x => x.trim());
    const codigo = cols[0] || "";
    const descricao = cols[1] || "";
    const categoria = cols[2] || inferCategoria(`${codigo} ${descricao}`);
    if(!codigo || !descricao) continue;
    await addDoc(collection(db,"empresas",EMPRESA_ID,"materiais"), { nome:`${codigo} — ${descricao}`, codigo, descricao, categoria, createdAt:new Date().toISOString() });
    count++;
  }
  await loadMateriais();
  alert(`Importação concluída. Materiais importados: ${count}.`);
  renderCadastrarMateriais();
}

function renderPlanejamento(){
  gerarPlano();
  document.getElementById("cardCentral").innerHTML = `<div class="module-panel">${planoDia.map(p=>`<div class="list-item"><strong>${esc(p.nome)}</strong><br>${badge(p.setor)} ${badge(p.area)}<div class="muted">Carga: ${p.horas.toFixed(1)}h / 8h</div><div style="margin-top:8px">${p.tarefas.length ? p.tarefas.map(t=>`${esc(t.titulo)} • ${t.horas.toFixed(1)}h • prioridade ${t.prioridade}`).join("<br>") : "Sem tarefas"}</div></div>`).join("")}</div>`;
}
function renderEquipe(){
  if(!planoDia.length) gerarPlano();
  const minha = currentUser.role==="manutentor" ? planoDia.filter(p=>p.nome===currentUser.nome) : planoDia;
  document.getElementById("cardCentral").innerHTML = `<div class="module-panel">${minha.length ? minha.map(p=>`<div class="list-item"><strong>${esc(p.nome)}</strong><br>${badge(p.setor)} ${badge(p.area)}<div class="muted">Carga atual: ${p.horas.toFixed(1)}h</div><div style="margin-top:8px">${p.tarefas.length ? p.tarefas.map(t=>`${esc(t.titulo)} • ${t.horas.toFixed(1)}h`).join("<br>") : "Sem tarefas"}</div></div>`).join("") : `<div class="list-item">Sem programação.</div>`}</div>`;
}
function renderGestor(){
  const manutentores=users.filter(u=>u.role==="manutentor").length;
  const gestores=users.filter(u=>u.role==="gestor").length;
  const globais=users.filter(u=>u.role==="gestor_global").length;
  document.getElementById("cardCentral").innerHTML = `<div class="kpis"><div class="kpi"><div class="num">${users.length}</div><div>Usuários</div></div><div class="kpi"><div class="num">${manutentores}</div><div>Manutentores</div></div><div class="kpi"><div class="num">${gestores}</div><div>Gestores</div></div><div class="kpi"><div class="num">${globais}</div><div>Gestor Global</div></div></div><div class="module-panel">${users.map(u=>`<div class="list-item"><strong>${esc(u.nome)}</strong><br>${badge(u.role)} ${badge(u.setor || "-")} ${badge(u.area || "-")}<div class="muted">${esc(u.email || "-")}</div></div>`).join("")}</div>`;
}
function renderConfig(){
  const oldCount = users.filter(u => u.status !== undefined || u.setorId !== undefined || u.setorPrincipalId !== undefined || u.areaPadrinhoId !== undefined).length;
  document.getElementById("cardCentral").innerHTML = `<div class="module-panel"><div class="muted ok">Empresa fixa: PROMETEON.</div><div class="muted ok">Login inteligente: se o usuário existir no Auth e faltar perfil, ele é criado automaticamente.</div><div class="muted warn">Usuários com modelo antigo detectados: ${oldCount}</div>${currentUser.role==="gestor_global" ? `<div class="row"><button class="small-btn secondary" onclick="migrarModeloAntigo()">Migrar modelo antigo agora</button></div>` : ""}${(currentUser.role==="gestor" || currentUser.role==="gestor_global") ? `<div class="row"><button class="small-btn secondary" onclick="gerarCenarioIndustrial()">Gerar cenário industrial</button></div>` : ""}</div>`;
}
