// Korean copy shared across screens: header, navigation, stage and attacker names, derive.js sentences,
// and messages the controller stores in state. Keys are the exact English strings passed to t().
export const KO_COMMON = {
  // Shell and header
  'Skip to content': '본문으로 건너뛰기',
  'Workflow': '워크플로',
  'Language': '언어',
  'Close': '닫기',
  'Start': '시작',
  'Run': '실행',
  'Verify': '검증',
  'Decide': '결정',
  'RECORDED REPLAY': '녹화 REPLAY',
  'LIVE': 'LIVE',
  'REPLAY': 'REPLAY',
  'SAMPLE DATA': '샘플 데이터',

  // Pipeline stages (STAGE_LABEL)
  'Guardrail': 'Guardrail',
  'Scope': 'Scope',
  'Blind plan': 'Blind plan',
  'Swarm': 'Swarm',
  'Sandbox A': 'Sandbox A',
  'Sandbox B': 'Sandbox B',
  'Score & card': '점수 & 카드',

  // Attackers (ATTACKER_LABEL)
  'Security': '보안',
  'Edge Case': '엣지 케이스',
  'State': '상태',
  'Regression': '회귀',

  // Phase labels
  '1 run': '1회 실행',
  'Held': '통과',
  '2/2 repro': '2/2 재현',
  'Held 2/2': '2/2 통과',
  'Phase 1 · 3 attackers · 1 run': 'Phase 1 · 공격자 3명 · 1회 실행',
  'Phase 2 · 4 attackers · 2× repro': 'Phase 2 · 공격자 4명 · 2회 재현',

  // Scene summaries
  'Blocked at Stage 0. No attackers were dispatched.': 'Stage 0에서 차단됨. 공격자를 투입하지 않았습니다.',
  '{caught} of {total} hidden mutants caught.': '숨겨진 mutant {total}개 중 {caught}개 탐지.',
  '{ids} survived.': '{ids} 생존.',
  'Waiting for a run.': '실행 대기 중.',
  '{caught} of {total} hidden mutants caught so far.': '지금까지 숨겨진 mutant {total}개 중 {caught}개 탐지.',

  // Verdicts
  'Reject recommended': '반려 권장',
  'Review with caution': '주의해서 검토',
  'Approve recommended': '승인 권장',

  // Screen-reader announcements and error leads
  'Run complete: {caught} of {total} planted bugs caught': '실행 완료: 심어둔 버그 {total}개 중 {caught}개 탐지',
  'Run blocked at Stage 0: the guardrail flagged this PR': 'Stage 0에서 실행 차단: Guardrail이 이 PR을 위험으로 표시했습니다',
  'Run stopped: {message}': '실행 중단: {message}',
  'unknown error': '알 수 없는 오류',
  '{stage} started': '{stage} 시작',
  'You stopped the run. Results up to this point are kept below.': '실행을 중지했습니다. 지금까지의 결과는 아래에 남아 있습니다.',
  'The connection closed before the run finished. Results up to this point are kept below.': '실행이 끝나기 전에 연결이 끊겼습니다. 지금까지의 결과는 아래에 남아 있습니다.',

  // Messages the controller puts in state; views render them with t(message)
  'A run is in progress. Stop it or wait for it to finish.': '실행이 진행 중입니다. 중지하거나 끝날 때까지 기다려 주세요.',
  'The stream ended before the run finished.': '실행이 끝나기 전에 스트림이 종료되었습니다.',
  'Stopped by you.': '사용자가 중지함.',
};
