# Prompt Templates

OpenClaw/NadFun ChatOps v0 프롬프트 템플릿 모음.

## KR
- `prompts/kr/base_system.md`
- `prompts/kr/relayer_next_server.md`
- `prompts/kr/strategy_moltbot.md`
- `prompts/kr/participant_moltbot.md`

권장 사용 순서:
1. `base_system` prepend
2. 역할별 템플릿 선택
3. 런타임 placeholder 치환
4. JSON schema 검증 후 파이프라인 전달
