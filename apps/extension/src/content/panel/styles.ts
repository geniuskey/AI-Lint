export const PANEL_STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }

.fab {
  position: fixed; left: 20px; bottom: 20px; z-index: 2147483000;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border: none; border-radius: 999px;
  background: #1e293b; color: #fff; font-size: 13px; font-weight: 600;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.3); cursor: pointer;
}
.fab:hover { background: #334155; }
.badge:empty { display: none; }
.badge {
  min-width: 20px; padding: 1px 6px; border-radius: 6px;
  background: #38bdf8; color: #0f172a; font-size: 12px;
}

.panel {
  position: fixed; left: 0; top: 0; bottom: 0; width: 420px; max-width: 100vw;
  z-index: 2147483001; display: flex; flex-direction: column;
  background: #fff; color: #0f172a; font-size: 13px; line-height: 1.6;
  border-right: 1px solid #e2e8f0; box-shadow: 4px 0 24px rgba(15, 23, 42, 0.12);
  transform: translateX(-100%); transition: transform 160ms ease-out;
}
.panel.open { transform: translateX(0); }

header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
header h1 { margin: 0; font-size: 14px; }
.close { border: none; background: none; font-size: 13px; color: #64748b; cursor: pointer; }

.score { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
.grade { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 10px; background: #0f172a; color: #fff; font-size: 20px; font-weight: 700; }
.grade[data-grade='A'] { background: #16a34a; }
.grade[data-grade='B'] { background: #0ea5e9; }
.grade[data-grade='C'] { background: #f59e0b; }
.grade[data-grade='D'] { background: #dc2626; }
.total { font-size: 20px; font-weight: 700; }
.axes { color: #64748b; font-size: 12px; }
.doctype { margin-left: auto; padding: 4px; font-size: 12px; }

.banner { padding: 10px 16px; font-size: 12px; }
.banner[data-tone='warn'] { background: #fef3c7; color: #92400e; }
.banner[data-tone='error'] { background: #fee2e2; color: #991b1b; }
.status { padding: 8px 16px; color: #64748b; font-size: 12px; }
.status:empty { display: none; }
.body { flex: 1; overflow-y: auto; padding: 0 16px 24px; }

.empty { padding: 24px 0; color: #64748b; text-align: center; }
.group { margin-top: 18px; }
.group h2 { margin: 0 0 8px; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
.group ul { margin: 0; padding: 0; list-style: none; }

.finding { padding: 12px; margin-bottom: 8px; border: 1px solid #e2e8f0; border-left-width: 3px; border-radius: 8px; }
.finding[data-severity='error'] { border-left-color: #dc2626; }
.finding[data-severity='warning'] { border-left-color: #f59e0b; }
.finding[data-severity='info'] { border-left-color: #0ea5e9; }
.finding-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 11px; color: #64748b; }
.rule { font-weight: 700; color: #0f172a; }
.src { padding: 0 5px; border-radius: 4px; background: #ede9fe; color: #6d28d9; }
.message { margin: 0 0 4px; font-weight: 600; }
.why { margin: 0; color: #475569; }
.evidence { margin: 6px 0 0; padding: 6px 8px; background: #f8fafc; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.suggestion { margin-top: 8px; padding: 8px; background: #f1f5f9; border-radius: 6px; }
.suggestion del { display: block; background: #fee2e2; text-decoration: none; }
.suggestion ins { display: block; background: #dcfce7; text-decoration: none; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
.actions button, .actions a { padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; font-size: 12px; text-decoration: none; cursor: pointer; }
`
