import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../shared/settings.js'

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`요소를 찾지 못했습니다: ${id}`)
  return found as T
}

const area = chrome.storage.sync

async function fillRulesets(selected: string): Promise<void> {
  const select = el<HTMLSelectElement>('rulesetId')
  select.replaceChildren(new Option(selected, selected, true, true))

  const settings = await loadSettings(area)
  if (!settings.backendUrl || !settings.serviceToken) return

  try {
    const response = await fetch(`${settings.backendUrl}/v1/rulesets`, {
      headers: { 'X-AI-Lint-Token': settings.serviceToken },
    })
    if (!response.ok) return
    const { rulesets } = (await response.json()) as { rulesets: Array<{ id: string; name: string }> }
    select.replaceChildren(
      ...rulesets.map((ruleset) => new Option(ruleset.name, ruleset.id, false, ruleset.id === selected)),
    )
  } catch {
    // 백엔드가 아직 설정되지 않았을 뿐이다. 저장된 값만 보여준다.
  }
}

async function init(): Promise<void> {
  const settings = await loadSettings(area)
  el<HTMLInputElement>('backendUrl').value = settings.backendUrl
  el<HTMLInputElement>('serviceToken').value = settings.serviceToken
  el<HTMLInputElement>('userId').value = settings.userId
  el<HTMLInputElement>('useLlm').checked = settings.useLlm
  el<HTMLInputElement>('autoRun').checked = settings.autoRun
  await fillRulesets(settings.rulesetId || DEFAULT_SETTINGS.rulesetId)

  el('save').addEventListener('click', () => {
    void saveSettings(area, {
      backendUrl: el<HTMLInputElement>('backendUrl').value,
      serviceToken: el<HTMLInputElement>('serviceToken').value,
      userId: el<HTMLInputElement>('userId').value,
      useLlm: el<HTMLInputElement>('useLlm').checked,
      autoRun: el<HTMLInputElement>('autoRun').checked,
      rulesetId: el<HTMLSelectElement>('rulesetId').value,
    }).then(() => {
      const status = el('status')
      status.textContent = '저장했습니다'
      setTimeout(() => (status.textContent = ''), 2000)
    })
  })
}

void init()
