# 룰 카탈로그

문서 검사 룰 31개와 추적성 룰 6개.

카탈로그의 단일 진실 공급원은 `packages/rules/src/catalog/meta.ts`입니다. 규칙셋 검증, `GET /v1/rules`, LLM 프롬프트 생성이 모두 이 표를 참조합니다. 실행 중인 백엔드에서 그대로 받아볼 수도 있습니다.

```bash
curl -s $BACKEND/v1/rules -H "x-ai-lint-token: $SERVICE_TOKEN" | jq '.rules[] | {id, name, axis, llm}'
```

**LLM** 표시가 붙은 룰은 모델이 판정합니다. `useLlm: false`로 요청하거나 쿼터가 소진되면 이 룰들은 돌지 않습니다.

**옵션**은 규칙셋에서 룰별로 덮어쓸 수 있습니다.

## 구조 · 청킹 친화성 (STR) {#구조-청킹-친화성-str}

가중치 **0.35**. 문서를 청크로 자를 때 경계가 제대로 잡히는지, 텍스트로 추출은 되는지를 봅니다. 전부 결정적 룰이라 LLM 없이도 돕니다.

| ID | 이름 | 심각도 | 설명 | 기본 옵션 |
|---|---|---|---|---|
| STR001 | heading-hierarchy-skip | warning | 제목 레벨을 건너뜁니다 (예: h2 다음에 h4). | |
| STR002 | no-headings | error | 긴 문서인데 제목이 하나도 없습니다. | `minChars: 800` |
| STR003 | section-too-long | warning | 한 섹션이 너무 길어 청크가 여러 주제를 섞습니다. | `maxSectionChars: 1500` |
| STR004 | table-as-image | error | 표나 도표가 이미지로만 존재해 텍스트로 추출할 수 없습니다. | |
| STR005 | image-missing-alt | error | 이미지에 대체 텍스트나 캡션이 없습니다. | |
| STR006 | code-block-no-language | info | 코드블록에 언어가 지정되지 않았습니다. | `minLines: 3` |
| STR007 | vague-link-text | warning | "여기", "링크" 같은 무의미한 링크 텍스트입니다. | |
| STR008 | layout-table | info | 데이터가 아니라 레이아웃 목적으로 쓰인 표입니다. | |
| STR009 | table-no-header | warning | 표에 헤더 행이 없어 각 열의 의미를 알 수 없습니다. | |
| STR010 | deep-nesting | info | 목록이 너무 깊게 중첩되어 있습니다. | `maxDepth: 3` |
| STR011 | attachment-only | error | 본문이 거의 없고 첨부파일에만 내용이 있습니다. | `minChars: 200` |
| STR012 | unrendered-macro | warning | 내용을 담은 매크로가 텍스트로 추출되지 않았습니다. | |
| STR013 | emphasis-as-heading | warning | 제목 스타일 대신 굵게·큰 글씨로 제목을 표현했습니다. | |
| STR014 | scanned-pdf | error | PDF에 텍스트 레이어가 없어 내용을 추출할 수 없습니다. | |

::: tip 왜 error가 몰려 있나
STR004, STR005, STR011, STR014는 전부 "내용이 아예 추출되지 않는다"는 뜻입니다. 표가 이미지면 그 안의 숫자는 검색에도 답변에도 절대 등장하지 않습니다. 읽기 불편한 것과 읽히지 않는 것은 다른 문제라 error로 둡니다.
:::

## 맥락 자립성 (CTX) {#맥락-자립성-ctx}

가중치 **0.45**. 아홉 개 전부 **LLM** 판정입니다.

문서가 자기 안에서 닫혀 있는지를 봅니다. 검색이 이 문서 한 조각을 가져왔을 때, 그것만으로 답이 되는가 하는 질문입니다.

| ID | 이름 | 심각도 | 설명 | 적용 대상 |
|---|---|---|---|---|
| CTX001 | dangling-reference | error | "지난번 논의대로", "위 표 참고"처럼 문서 안에서 해소되지 않는 참조입니다. | 전체 |
| CTX002 | undefined-term | warning | 정의 없이 등장하는 약어, 사내 은어, 코드네임입니다. | 전체 |
| CTX003 | missing-purpose | warning | 문서의 목적과 범위가 도입부에 명시되지 않았습니다. | 전체 |
| CTX004 | ambiguous-actor | warning | 주어가 생략되어 행위 주체가 불명확합니다. | 전체 |
| CTX005 | unresolved-pronoun | warning | 지시대명사가 가리키는 대상이 같은 섹션 안에 없습니다. | 전체 |
| CTX006 | relative-time | info | "현재", "최근", "다음 주"처럼 절대 시점이 없는 시간 표현입니다. | 전체 |
| CTX007 | decision-without-rationale | warning | 결정만 있고 근거나 검토한 대안이 없습니다. | `design`, `meeting-notes`, `requirement` |
| CTX008 | section-topic-drift | warning | 섹션 제목과 실제 내용이 어긋납니다. | 전체 |
| CTX009 | external-assumption | info | 문서 밖에 있는 전제에 의존해야 문장이 성립합니다. | 전체 |

::: warning LLM 지적은 검증을 통과한 것만 남습니다
모델은 판정할 때 근거가 된 본문 문장을 함께 내야 하고, 그 문장이 실제 본문에 존재하는지 대조합니다. 없으면 그 지적은 버려지고 `stats.llmFindingsRejected`에 집계됩니다. 확신도 하한도 함께 적용됩니다.
:::

CTX007만 적용 대상이 제한되어 있습니다. 회의록에 결정 근거가 없다는 지적은 타당하지만, API 문서에 같은 지적을 하면 소음이기 때문입니다.

## 메타데이터 · 최신성 (META) {#메타데이터-최신성-meta}

가중치 **0.20**. 여덟 개 중 META001과 META007이 **LLM** 판정입니다.

| ID | 이름 | 심각도 | LLM | 설명 | 기본 옵션 |
|---|---|---|:---:|---|---|
| META001 | title-not-descriptive | warning | ● | 제목이 내용을 대변하지 못합니다. | |
| META002 | missing-summary | warning | | 긴 문서인데 요약이나 TL;DR이 없습니다. | `minChars: 1200` |
| META003 | no-labels | info | | 라벨이 하나도 없습니다. | |
| META004 | no-owner | info | | 문서 소유자나 담당자가 기재되지 않았습니다. | |
| META005 | stale-document | info | | 최종 수정 후 오랜 시간이 지났습니다. | `staleMonths: 12` |
| META006 | broken-link | warning | | 깨진 링크가 있습니다. | |
| META007 | missing-required-section | error | ● | 이 문서 유형에 필요한 섹션이 빠졌습니다. | |
| META008 | draft-marker | warning | | TBD, 작성중 같은 미완성 표식이 남아 있습니다. | |

META001이 LLM인 이유는 제목이 내용을 대변하는지 판단하려면 본문을 읽어야 하기 때문입니다. META007도 마찬가지로, 어떤 섹션이 필요한지는 문서 유형에 달려 있고 섹션 이름은 문서마다 다르게 붙습니다.

META006(깨진 링크)은 Confluence 확장에서 [사용자 세션으로 확인](/guide/extension#링크-검사)합니다. 권한이 없어 403이 나는 것과 문서가 사라진 404를 구분하려면 그래야 합니다.

## 문서간 추적성 (TRC) {#문서간-추적성-trc}

**문서 점수에 들어가지 않습니다.** `RULE_META`에 없고 `POST /v1/trace/analyze`의 별도 리포트로만 나갑니다. 코퍼스 상태에 따라 판정이 달라지는 룰을 단일 문서 점수에 섞으면, 남이 문서를 안 올렸다는 이유로 내 문서 등급이 떨어지기 때문입니다.

| ID | 심각도 | 메시지 | 판정 근거 |
|---|---|---|---|
| TRC001 | error | 정의되지 않은 식별자를 참조합니다 | 참조는 있는데 정의하는 문서가 인덱스에 없음 |
| TRC002 | warning | 설계 문서가 요구사항을 참조하지 않습니다 | `design` 문서에 requirement 식별자가 없음 |
| TRC003 | warning | 요구사항에 연결된 테스트가 없습니다 | 그 요구사항을 참조하는 문서 중 test 식별자를 가진 것이 없음 |
| TRC004 | error | 같은 식별자를 두 문서가 정의합니다 | 정의 문서가 2개 이상 |
| TRC005 | info | 링크 대상 문서가 인덱스에 없습니다 | 내부 링크의 대상 URI가 코퍼스에 없음 |
| TRC006 | error | 같은 식별자에 대한 서술이 서로 어긋납니다 | **LLM** — 두 문서 발췌를 대조 |

자세한 동작은 [문서간 추적성](/guide/traceability)을 보세요.

## 점수 계산

축마다 100점에서 시작해 지적마다 깎입니다.

| 심각도 | 감점 |
|---|---|
| error | 15 |
| warning | 6 |
| info | 2 |

같은 룰이 **4번째부터**는 1점만 깎습니다. 이미지 40장에 alt가 없다고 그 하나가 점수를 독점하면, 정작 심각한 다른 문제가 점수에 드러나지 않습니다.

```
총점 = 구조 × 0.35 + 맥락 × 0.45 + 메타데이터 × 0.20
```

| 등급 | 총점 |
|---|---|
| A | 90 이상 |
| B | 75 이상 |
| C | 60 이상 |
| D | 그 미만 |

## 규칙셋으로 조정하기

룰별로 끄거나, 심각도를 바꾸거나, 옵션을 덮어씁니다.

```json
{
  "id": "engineering",
  "version": 3,
  "rules": {
    "STR006": { "enabled": false },
    "STR003": { "enabled": true, "severity": "error", "options": { "maxSectionChars": 900 } },
    "META005": { "enabled": true, "severity": "warning", "options": { "staleMonths": 6 } }
  }
}
```

알 수 없는 룰 ID가 들어 있으면 로드가 거부됩니다. 오타 난 규칙셋이 조용히 아무것도 안 하는 상황을 막기 위한 것입니다.

`GET /v1/rulesets`로 목록을, `GET /v1/rulesets/:id`로 내용을 확인합니다.
