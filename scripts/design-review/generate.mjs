import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Read source only: no application execution, credentials, network, or database access.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/design-review');
const app = 'apps/web/src/app';
const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const tidy = text => text.replace(/\s+/g, ' ').trim();
const short = (text, n = 180) => tidy(text).slice(0, n);
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(file) : /\.(tsx?|jsx?)$/.test(file) && !/\.(test|spec)\./.test(file) ? [file] : [];
  });
}
const files = [...walk('apps/web/src'), ...walk('packages/ui/src')].sort();
const nodes = new Map(files.map(file => [file, ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)]));
const styles = new Map();
const styleImports = new Map();
for (const [file, sf] of nodes) {
  const imported = [];
  for (const s of sf.statements) if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text.startsWith('.') && s.moduleSpecifier.text.endsWith('.css')) {
    const css = path.posix.normalize(path.posix.join(path.posix.dirname(file), s.moduleSpecifier.text));
    if (fs.existsSync(path.join(root, css))) { styles.set(css, fs.readFileSync(path.join(root, css), 'utf8')); imported.push(css); }
  }
  styleImports.set(file, imported);
}
const unresolved = [];
function resolve(from, spec) {
  let base;
  if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else if (spec.startsWith('@/')) base = `apps/web/src/${spec.slice(2)}`;
  else if (spec === '@bpt-jersey/ui') base = 'packages/ui/src/index';
  else return;
  const target = [base, ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'].map(s => base + s)].find(p => nodes.has(p));
  if (!target && !/\.(css|svg|json|png|jpg|webp)$/.test(spec) && !unresolved.some(x => x.file === from && x.spec === spec)) unresolved.push({ file: from, spec });
  return target;
}
for (const [file, sf] of nodes) {
  function visit(n) {
    let spec;
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) spec = n.moduleSpecifier.text;
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(n.arguments[0])) spec = n.arguments[0].text;
    if (spec) resolve(file, spec);
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
// Follow used declarations, rather than treating a named helper import as use of
// every component exported by that file. Dynamic imports remain conservative.
const modules = new Map();
for (const [file, sf] of nodes) {
  const locals = new Map(), imports = new Map(), exports = new Map(), stars = [];
  for (const s of sf.statements) {
    const exported = s.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = s.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
      const target = resolve(file, s.moduleSpecifier.text), c = s.importClause;
      if (!target || !c || c.isTypeOnly) continue;
      if (c.name) imports.set(c.name.text, { file: target, symbol: 'default' });
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) imports.set(c.namedBindings.name.text, { file: target, symbol: '*' });
      else if (c.namedBindings) for (const e of c.namedBindings.elements) if (!e.isTypeOnly) imports.set(e.name.text, { file: target, symbol: e.propertyName?.text ?? e.name.text });
    } else if (ts.isExportDeclaration(s) && !s.isTypeOnly) {
      const target = s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? resolve(file, s.moduleSpecifier.text) : null;
      if (s.exportClause && ts.isNamedExports(s.exportClause)) for (const e of s.exportClause.elements) exports.set(e.name.text, target ? { file: target, symbol: e.propertyName?.text ?? e.name.text } : { local: e.propertyName?.text ?? e.name.text });
      else if (target) stars.push(target);
    } else if (ts.isExportAssignment(s)) exports.set('default', { node: s });
    else if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) {
      if (s.name) locals.set(s.name.text, s);
      if (exported && s.name) exports.set(isDefault ? 'default' : s.name.text, { node: s });
      else if (isDefault) exports.set('default', { node: s });
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) { locals.set(d.name.text, d); if (exported) exports.set(d.name.text, { node: d }); }
    }
  }
  modules.set(file, { locals, imports, exports, stars });
}
function closure(seeds) {
  const selected = new Map(), seen = new Set();
  function symbol(file, name) {
    const key = `${file}:${name}`; if (seen.has(key)) return; seen.add(key);
    const m = modules.get(file); if (!m) return;
    if (!selected.has(file)) selected.set(file, new Set());
    if (name === '*') { for (const n of m.exports.keys()) symbol(file, n); for (const f of m.stars) symbol(f, '*'); return; }
    const exp = m.exports.get(name);
    if (exp?.file) symbol(exp.file, exp.symbol);
    else if (exp?.node) declaration(file, exp.node);
    else if (exp?.local) local(file, exp.local);
    else for (const f of m.stars) symbol(f, name);
  }
  function local(file, name) {
    const m = modules.get(file), dep = m.imports.get(name);
    if (dep) symbol(dep.file, dep.symbol);
    else if (m.locals.has(name)) declaration(file, m.locals.get(name));
  }
  function declaration(file, n) {
    if (!selected.has(file)) selected.set(file, new Set());
    const used = selected.get(file); if (used.has(n)) return; used.add(n);
    function visit(child) {
      if (ts.isTypeNode(child)) return;
      if (ts.isIdentifier(child)) local(file, child.text);
      if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(child.arguments[0])) { const target = resolve(file, child.arguments[0].text); if (target) symbol(target, '*'); }
      ts.forEachChild(child, visit);
    }
    ts.forEachChild(n, visit);
  }
  seeds.forEach(file => symbol(file, 'default'));
  return { files: [...selected.keys()].sort(), selected };
}
const routeUsage = new Map();
const names = {
  '/': 'Inicio', '/login': 'Acceso de miembros', '/staff/login': 'Acceso del equipo', '/enrol': 'Inscripción', '/shop': 'Tienda', '/courses': 'Catálogo de cursos', '/courses/view': 'Detalle del curso', '/checkin': 'Entrada desde QR / NFC', '/accounts': 'Alias de la cuenta',
  '/account': 'Calendario y asistencia', '/account/billing': 'Facturas y pagos', '/account/competitors': 'Clasificación y perfiles', '/account/courses': 'Mis cursos y solicitudes', '/account/courses/calendar': 'Calendario de cursos', '/account/family': 'Mi familia', '/account/guardian-profile': 'Perfil del tutor', '/account/membership': 'Mi plan', '/account/private-lessons': 'Clases privadas', '/account/profile': 'Perfil del estudiante', '/account/progress': 'Mi progreso', '/account/settings': 'Ajustes de cuenta', '/account/waitlist': 'Lista de espera e invitaciones', '/account/waiver': 'Consentimientos',
  '/coach': 'Panel del coach', '/coach/access': 'Acceso del coach', '/admin': 'Resumen de administración', '/admin/attendance': 'Asistencia', '/admin/billing': 'Acceso antiguo a finanzas', '/admin/classes': 'Acceso antiguo a clases', '/admin/classes-services': 'Entrada a clases y servicios', '/admin/classes-services/classes': 'Calendario de clases y servicios', '/admin/classes-services/groups': 'Grupos', '/admin/classes-services/history': 'Historial de inscripciones', '/admin/classes-services/locations': 'Sedes y salas', '/admin/classes-services/memberships': 'Membresías y bonos (pantalla provisional)', '/admin/classes-services/options': 'Opciones (pantalla provisional)', '/admin/classes-services/types': 'Tipos de clase y servicio', '/admin/courses': 'Gestión de cursos', '/admin/crm': 'Seguimiento CRM', '/admin/families': 'Gestión de familias', '/admin/finance': 'Finanzas', '/admin/graduations': 'Graduaciones', '/admin/levels': 'Cinturones y técnicas', '/admin/members': 'Directorio de miembros', '/admin/members/add': 'Alta de estudiante adulto', '/admin/members/import': 'Importación de miembros', '/admin/members/medical': 'Revisión médica', '/admin/members/migration': 'Recuperación de miembros antiguos', '/admin/members/profile': 'Ficha del miembro', '/admin/members/requests': 'Solicitudes de inscripción', '/admin/members/search': 'Búsqueda de miembros', '/admin/memberships': 'Planes y suscripciones', '/admin/reports': 'Informes', '/admin/retention': 'Seguimiento de permanencia', '/admin/shop': 'Gestión de tienda', '/admin/staff': 'Equipo y permisos', '/admin/waitlists': 'Gestión de listas de espera', '/admin/waivers': 'Versiones y aceptación de consentimientos',
};
function area(route) {
  if (route.startsWith('/account/') || route === '/account' || route === '/accounts') return 'Miembros y familias';
  if (route.startsWith('/coach')) return 'Coaches';
  if (/^\/admin\/(members(?:\/|$)|families|staff)/.test(route)) return 'Administración · personas';
  if (/^\/admin\/(classes|attendance|courses|waitlists|levels|graduations)/.test(route)) return 'Administración · actividad';
  if (route.startsWith('/admin')) return 'Administración · gestión';
  return 'Sitio público y acceso';
}
const redirects = { '/accounts': '/account', '/checkin': '/account?checkin', '/admin/billing': '/admin/finance', '/admin/classes': '/admin/classes-services/classes', '/admin/classes-services': '/admin/classes-services/classes' };
const areaOrder = ['Sitio público y acceso', 'Miembros y familias', 'Coaches', 'Administración · personas', 'Administración · actividad', 'Administración · gestión'];
const routes = files.filter(f => f.startsWith(`${app}/`) && /\/page\.[jt]sx?$/.test(f)).map(file => {
  const route = '/' + path.posix.dirname(file).slice(app.length + 1).split('/').filter(s => s && !/^\(.*\)$/.test(s)).join('/');
  const layouts = [];
  for (let dir = path.posix.dirname(file); dir.startsWith(app); dir = path.posix.dirname(dir)) for (const name of ['layout.tsx', 'template.tsx', 'loading.tsx', 'error.tsx', 'not-found.tsx']) if (nodes.has(`${dir}/${name}`)) layouts.push(`${dir}/${name}`);
  const full = closure([file, ...layouts]); routeUsage.set(route, full.selected);
  return { id: `route:${route}`, route, name: names[route] ?? route, area: area(route), file, target: redirects[route] ?? null, files: full.files, styleFiles: [...new Set(full.files.flatMap(f => styleImports.get(f) ?? []))].sort(), directFiles: closure([file]).files };
}).sort((a, b) => areaOrder.indexOf(a.area) - areaOrder.indexOf(b.area) || a.route.localeCompare(b.route));
const items = [];
const occurrences = new Map();
function add(file, n, kind, title, context = '', explicitKey) {
  const sf = nodes.get(file);
  const line = n ? sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 : 1;
  const semantic = `${file}|${kind}|${title}|${context}`;
  const index = (occurrences.get(semantic) ?? 0) + 1; occurrences.set(semantic, index);
  const id = explicitKey ?? `ui:${hash(`${semantic}|${index}`)}`;
  items.push({ id, file, line, kind, title: short(title, 240), context: short(context, 320), fingerprint: hash(n ? n.getText(sf) : sf.text), routes: routes.filter(r => {
    const selected = routeUsage.get(r.route).get(file);
    return selected && (!n || [...selected].some(parent => n.pos >= parent.pos && n.end <= parent.end));
  }).map(r => r.route) });
}
function hasJsx(n) { if (!n) return false; if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return true; return Boolean(ts.forEachChild(n, hasJsx)); }
function visible(n) {
  if (ts.isJsxText(n)) return n.text;
  if (ts.isJsxExpression(n)) {
    if (!n.expression) return '';
    if (ts.isStringLiteral(n.expression)) return n.expression.text;
    if (hasJsx(n.expression)) return '{contenido según estado}';
    return `{${short(n.expression.getText(), 90)}}`;
  }
  return (n.children ?? []).map(visible).join(' ');
}
function attrs(open) {
  return Object.fromEntries(open.attributes.properties.filter(ts.isJsxAttribute).map(a => [a.name.getText(), a.initializer ? ts.isStringLiteral(a.initializer) ? a.initializer.text : a.initializer.getText().replace(/^\{|\}$/g, '') : 'true']));
}
function owner(n) {
  for (let p = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  }
  return '';
}
for (const [file, sf] of nodes) {
  if (file.endsWith('.tsx')) add(file, null, 'componente', path.posix.basename(file, '.tsx'), 'Archivo de interfaz; revisar también contenido estático y estilos.', `file:${file}`);
  const aliases = new Map();
  function collect(n) { if (ts.isTypeAliasDeclaration(n)) aliases.set(n.name.text, n.type); ts.forEachChild(n, collect); }
  collect(sf);
  function literals(n, seen = new Set()) {
    if (!n) return [];
    if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal)) return [n.literal.text];
    if (ts.isTypeReferenceNode(n)) {
      const name = n.typeName.getText(sf);
      if (aliases.has(name) && !seen.has(name)) return literals(aliases.get(name), new Set([...seen, name]));
    }
    const values = []; ts.forEachChild(n, child => { values.push(...literals(child, seen)); }); return [...new Set(values)];
  }
  function visit(n) {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const open = ts.isJsxElement(n) ? n.openingElement : n;
      const tag = open.tagName.getText(sf), a = attrs(open), role = a.role;
      const text = short(visible(n));
      const label = a['aria-label'] || a.title || a.label || text || a.name || a.id || a['aria-labelledby'] || tag;
      let kind;
      if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') kind = 'diálogo';
      else if (role === 'tab' || role === 'tabpanel' || role === 'tablist') kind = 'pestaña';
      else if (tag === 'form' || tag === 'fieldset') kind = 'formulario';
      else if (['input', 'select', 'textarea'].includes(tag)) kind = 'campo';
      else if (tag === 'button' || role === 'button') kind = 'acción';
      else if (['a', 'Link'].includes(tag)) kind = 'enlace';
      else if (tag === 'details' || tag === 'summary') kind = 'desplegable';
      else if (role === 'alert' || role === 'status' || a['aria-live']) kind = 'mensaje';
      else if (/^h[1-6]$/.test(tag) || ['nav', 'header', 'footer', 'table', 'section'].includes(tag) || /SectionHeader$/.test(tag)) kind = 'sección';
      else if (/^[A-Z]/.test(tag) && !['Fragment', 'Suspense'].includes(tag)) kind = 'pieza';
      if (kind) {
        let fieldLabel = label;
        if (kind === 'campo') {
          for (let p = n.parent; p && p !== sf; p = p.parent) {
            if (ts.isJsxElement(p) && p.openingElement.tagName.getText(sf) === 'label') { fieldLabel = short(visible(p)); break; }
          }
        }
        add(file, n, kind, `${kind === 'campo' ? `${tag}${a.type ? ` (${a.type})` : ''}: ` : ''}${fieldLabel}`, [owner(n), a.href ? `Destino: ${a.href}` : '', a.disabled ? `Deshabilitado: ${a.disabled}` : '', a.required ? 'Obligatorio' : ''].filter(Boolean).join(' · '));
      }
    }
    if (ts.isConditionalExpression(n) && (hasJsx(n.whenTrue) || hasJsx(n.whenFalse) || ts.isJsxExpression(n.parent))) {
      const condition = short(n.condition.getText(sf), 180);
      const kind = /role|isOwner|isOffice|isStaff|isGuardian|\bcan[A-Z]|audience|permission/.test(condition) ? 'rol' : 'variante';
      add(file, n.whenTrue, kind, `Si ${condition}`, `${owner(n)} · ${short(visible(n.whenTrue)) || short(n.whenTrue.getText(sf), 160)}`);
      add(file, n.whenFalse, kind, `Si NO (${condition})`, `${owner(n)} · ${short(visible(n.whenFalse)) || short(n.whenFalse.getText(sf), 160)}`);
    }
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind) && hasJsx(n.right)) {
      const condition = short(n.left.getText(sf), 180);
      add(file, n, /role|isOwner|isOffice|isStaff|isGuardian|\bcan[A-Z]|audience|permission/.test(condition) ? 'rol' : 'variante', `Mostrar cuando ${n.operatorToken.kind === ts.SyntaxKind.BarBarToken ? 'NO ' : ''}${condition}`, owner(n));
    }
    if (ts.isIfStatement(n) && (hasJsx(n.thenStatement) || hasJsx(n.elseStatement))) add(file, n, /role|isOwner|isOffice|isStaff|isGuardian|\bcan[A-Z]|audience|permission/.test(n.expression.getText(sf)) ? 'rol' : 'variante', `Vista alternativa: ${short(n.expression.getText(sf))}`, owner(n));
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (/^(window\.)?(confirm|alert|prompt)$/.test(callee)) add(file, n, 'confirmación', short(n.arguments[0]?.getText(sf) ?? callee), owner(n));
      if (/^(React\.)?useState$/.test(callee)) {
        const state = ts.isVariableDeclaration(n.parent) ? n.parent.name.getText(sf).split(',')[0].replace('[', '') : owner(n);
        for (const value of literals(n.typeArguments?.[0])) add(file, n, /step|phase/i.test(state) ? 'paso' : /tab|view|mode|range/i.test(state) ? 'vista' : /role|audience/i.test(state) ? 'rol' : 'estado', `${state} → ${value}`, 'Valor declarado en el estado de interfaz. Confirmar cómo se muestra.');
      }
      if (/^set.*(?:Error|Message|Notice)$/i.test(callee) && n.arguments[0] && (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0])) && n.arguments[0].text) add(file, n, 'mensaje', n.arguments[0].text, owner(n));
    }
    // Configuration-driven navigation/options would otherwise be a single .map() item.
    if (ts.isObjectLiteralExpression(n)) {
      const props = Object.fromEntries(n.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(sf).replace(/["']/g, ''), p.initializer]));
      if (props.label && ts.isStringLiteral(props.label) && (props.href || props.value || props.id || props.key)) add(file, n, props.href ? 'enlace' : /tab|view/i.test(owner(n)) ? 'pestaña' : 'opción', props.label.text, `${owner(n)} · ${short((props.href ?? props.value ?? props.id ?? props.key).getText(sf))}`);
    }
    if (ts.isVariableDeclaration(n) && /(?:tabLabels|TabLabels)$/.test(n.name.getText(sf)) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      for (const p of n.initializer.properties) if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer)) add(file, p, 'pestaña', p.initializer.text, `${n.name.getText(sf)} · ${p.name.getText(sf)}`);
    }
    if (ts.isReturnStatement(n) && n.expression && ts.isStringLiteral(n.expression) && /error|message|failure/i.test(owner(n))) {
      let condition = '';
      for (let p = n.parent; p && p !== sf; p = p.parent) {
        if (ts.isIfStatement(p)) { condition = p.expression.getText(sf); break; }
        if (ts.isCaseClause(p)) { condition = `case ${p.expression.getText(sf)}`; break; }
        if (ts.isDefaultClause(p)) { condition = 'Error no reconocido / alternativa por defecto'; break; }
      }
      add(file, n, 'error', n.expression.text, `${owner(n)} · ${condition || 'Mensaje alternativo'}; confirmar presentación en interfaz.`);
    }
    if (ts.isNewExpression(n) && n.expression.getText(sf) === 'Error' && n.arguments?.[0] && ts.isStringLiteral(n.arguments[0])) add(file, n, 'error', n.arguments[0].text, `${owner(n)} · Mensaje del cliente; confirmar presentación en interfaz.`);
    if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression) && /^(auth|functions)\//.test(n.expression.text)) add(file, n, 'error', `Código: ${n.expression.text}`, owner(n));
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
for (const r of routes) {
  add(r.file, null, 'página', r.name, r.target ? `Alias / redirección a ${r.target}; revisar acceso y destino.` : 'Revisión completa de la página: diseño, móvil, escritorio, teclado, roles y estados aplicables.', r.id);
  // A page approval must become stale when one of its source dependencies changes.
  items.at(-1).fingerprint = hash([...r.files.map(f => `${f}:${hash(nodes.get(f).text)}`), ...r.styleFiles.map(f => `${f}:${hash(styles.get(f))}`)].join('|'));
  items.at(-1).routes = [r.route];
}
const used = new Set(routes.flatMap(r => r.files));
const looseFiles = files.filter(f => f.endsWith('.tsx') && !used.has(f));
const manual = JSON.parse(fs.readFileSync(path.join(out, 'scenarios.json'), 'utf8'));
for (const scenario of manual) {
  if (!nodes.has(scenario.file)) throw new Error(`Scenario source missing: ${scenario.file}`);
  const sf = nodes.get(scenario.file);
  const offset = sf.text.indexOf(scenario.anchor);
  if (offset < 0) throw new Error(`Scenario anchor missing: ${scenario.id}`);
  items.push({ ...scenario, kind: scenario.kind ?? 'recorrido', line: sf.getLineAndCharacterOfPosition(offset).line + 1, fingerprint: hash(sf.text), context: scenario.context ?? '', source: 'curado' });
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const data = {
  schema: 1, generatedAt: new Date().toISOString(), revision, baseUrl: 'https://www.bptjersey.com',
  scope: 'Inventario estático de código, no auditoría visual ni prueba de funcionamiento. Las rutas se asocian siguiendo declaraciones e imports utilizados; los imports dinámicos se incluyen de forma conservadora. Las condiciones, datos del servidor y estilos pueden producir combinaciones adicionales. Los valores de estado y ramas no afirman que toda combinación sea alcanzable. Revisar las piezas sin ruta y registrar nuevos casos descubiertos.',
  routes, items, looseFiles, looseItems: items.filter(i => i.routes.length === 0).map(i => i.id), unresolved,
  sourceFiles: files.map(file => ({ file, fingerprint: hash(nodes.get(file).text), routes: routes.filter(r => r.files.includes(file)).map(r => r.route) })),
  styleFiles: [...styles].map(([file, text]) => ({ file, fingerprint: hash(text), routes: routes.filter(r => r.styleFiles.includes(file)).map(r => r.route) })),
};
fs.mkdirSync(out, { recursive: true });
const oldPath = path.join(out, 'inventory.json');
if (fs.existsSync(oldPath)) {
  const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const previous = new Map(old.items.map(i => [i.id, i])); const current = new Map(items.map(i => [i.id, i]));
  data.delta = { added: items.filter(i => !previous.has(i.id)).map(i => i.id), removed: old.items.filter(i => !current.has(i.id)).map(i => ({ id: i.id, title: i.title, file: i.file })), changed: items.filter(i => previous.has(i.id) && previous.get(i.id).fingerprint !== i.fingerprint).map(i => i.id) };
} else data.delta = { added: items.map(i => i.id), removed: [], changed: [] };
fs.writeFileSync(oldPath, JSON.stringify(data, null, 2) + '\n');
const template = fs.readFileSync(path.join(root, 'scripts/design-review/viewer.html'), 'utf8');
fs.writeFileSync(path.join(out, 'mapa.html'), template.replace('__INVENTORY_JSON__', () => JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')));
const md = value => String(value).replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '').replace(/\|/g, '\\|');
const lines = ['# Mapa y lista de revisión · BPT Jersey', '', `Generado: ${data.generatedAt}. Código base: ${revision}.`, '', data.scope, '', 'El progreso interactivo se guarda en mapa.html (navegador + exportación JSON). Esta lista es una alternativa independiente para imprimir o editar; el generador la sobrescribe y no sincroniza sus casillas. Guarda una copia antes de marcarla.', '', '## Mapa de páginas', ''];
for (const group of [...new Set(routes.map(r => r.area))]) {
  lines.push(`### ${group}`, '');
  for (const r of routes.filter(r => r.area === group)) lines.push(`- [ ] **${r.name}** — \`${r.route}\`${r.target ? ` → \`${r.target}\`` : ''}`);
  lines.push('');
}
lines.push('## Recorridos y variantes agrupados', '');
for (const i of items.filter(i => i.source === 'curado')) lines.push(`- [ ] ${md(i.title)} — ${i.routes.map(r => `\`${r}\``).join(', ')}. ${md(i.context)} [Código](https://github.com/andresleosan/BPT-Jersey/blob/${revision}/${i.file}#L${i.line})`);
fs.writeFileSync(path.join(out, 'CHECKLIST-PAGES.md'), lines.join('\n') + '\n');
lines.push('', '## Inventario detallado por archivo (cada pieza una sola vez)', '');
for (const file of files) {
  const list = items.filter(i => i.file === file && i.kind !== 'página' && i.source !== 'curado');
  if (!list.length) continue;
  lines.push(`### ${file}`, '', `Rutas asociadas: ${routes.filter(r => r.files.includes(file)).map(r => `\`${r.route}\``).join(', ') || 'Sin ruta detectada; revisar uso o retiro.'}`, '');
  for (const i of list) lines.push(`- [ ] **${i.kind}** · ${md(i.title)}${i.context ? ` — ${md(i.context)}` : ''} ([L${i.line}](https://github.com/andresleosan/BPT-Jersey/blob/${revision}/${file}#L${i.line})) <!-- ${i.id} -->`);
  lines.push('');
}
lines.push('## Límites de cobertura', '', `Páginas: ${routes.length}. Archivos de código leídos: ${files.length}. Elementos: ${items.length}.`, '', `Archivos TSX sin ruta asociada: ${looseFiles.length}. Elementos sin ruta: ${data.looseItems.length}. Imports locales sin resolver: ${unresolved.length}.`, '', ...looseFiles.map(f => `- [ ] Resolver si se usa, se retira o se añade al mapa: \`${f}\``), ...items.filter(i => !i.routes.length).map(i => `- [ ] Resolver uso de **${md(i.title)}** en \`${i.file}:${i.line}\``), ...unresolved.map(x => `- [ ] Resolver import: \`${x.file}\` → \`${x.spec}\``));
fs.writeFileSync(path.join(out, 'CHECKLIST.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ routes: routes.length, items: items.length, looseFiles, unresolved, kinds: Object.fromEntries([...new Set(items.map(i => i.kind))].sort().map(k => [k, items.filter(i => i.kind === k).length])) }, null, 2));
