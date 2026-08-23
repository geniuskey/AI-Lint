export const PANEL_STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }

.fab {
  position: fixed; left: 20px; bottom: 20px; z-index: 2147483000;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border: none; border-radius: 999px;
  background: linear-gradient(135deg, #5b9ae0, #2a5da2); color: #fff; font-size: 13px; font-weight: 600;
  box-shadow: 0 6px 18px rgba(42, 93, 162, 0.42); cursor: pointer;
  transition: transform 140ms ease-out, box-shadow 140ms ease-out;
}
.fab:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(42, 93, 162, 0.5); }
.fab:active { transform: none; }
/* 로고도 파란 판이라 파란 버튼 위에서 묻힌다. 흰 테두리로 떼어 놓는다. */
.mark { display: flex; border-radius: 5px; box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.75); }
.mark svg { display: block; width: 18px; height: 18px; }
.badge:empty { display: none; }
.badge {
  min-width: 20px; padding: 1px 6px; border-radius: 6px;
  background: #fbbf24; color: #422006; font-size: 12px; font-weight: 700;
}

.panel {
  position: fixed; left: 0; top: 0; bottom: 0; width: 420px; max-width: 100vw;
  z-index: 2147483001; display: flex; flex-direction: column;
  background: #fff; color: #0f172a; font-size: 13px; line-height: 1.6;
  border-right: 1px solid #e2e8f0; box-shadow: 4px 0 24px rgba(15, 23, 42, 0.12);
  transform: translateX(-100%); transition: transform 160ms ease-out;
}
.panel.open { transform: translateX(0); }

header { position: relative; display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: linear-gradient(180deg, #f4f8fd, #fff); border-bottom: 1px solid #e2e8f0; }
/* 로고의 파랑과 앰버. 패널이 어느 위키에 떠도 여기가 AI-Lint임을 알린다. */
header::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: linear-gradient(90deg, #5b9ae0, #2a5da2 55%, #fbbf24); }
header h1 { margin: 0; font-size: 14px; letter-spacing: -0.01em; }
.close { padding: 3px 8px; border: none; border-radius: 6px; background: none; font-size: 13px; color: #64748b; cursor: pointer; }
.close:hover { background: #e2e8f0; color: #0f172a; }

.score { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
.grade { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 11px; background: #475569; color: #fff; font-size: 20px; font-weight: 700; }
.grade[data-grade='A'] { background: linear-gradient(140deg, #22c55e, #15803d); }
.grade[data-grade='B'] { background: linear-gradient(140deg, #5b9ae0, #2a5da2); }
.grade[data-grade='C'] { background: linear-gradient(140deg, #fbbf24, #d97706); }
.grade[data-grade='D'] { background: linear-gradient(140deg, #ef4444, #b91c1c); }
.total { font-size: 20px; font-weight: 700; }
.axes { color: #64748b; font-size: 12px; }
.doctype { margin-left: auto; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; font-size: 12px; }
.doctype:focus { outline: none; border-color: #5b9ae0; box-shadow: 0 0 0 3px rgba(91, 154, 224, 0.22); }

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

.finding { padding: 12px; margin-bottom: 8px; border: 1px solid #e2e8f0; border-left-width: 3px; border-radius: 8px; transition: box-shadow 140ms ease-out; }
.finding:hover { box-shadow: 0 6px 16px -10px rgba(15, 23, 42, 0.55); }
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
.actions button, .actions a { padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; font-size: 12px; font-weight: 600; text-decoration: none; cursor: pointer; }
.actions button:hover, .actions a:hover { border-color: #5b9ae0; color: #1d4ed8; background: #f0f6fd; }
`
