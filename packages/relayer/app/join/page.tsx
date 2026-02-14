export default function JoinPage() {
  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-gray-50 p-4">
      <div className="z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
        <div className="border-b border-gray-200 px-6 py-6 sm:px-10">
          <h1 className="text-2xl font-semibold text-gray-900">Fund Join Tutorial</h1>
          <p className="mt-2 text-sm text-gray-500">
            일반 유저용 참여/초기 셋업 가이드입니다.
          </p>
        </div>

        <ol className="list-decimal space-y-2 px-10 py-6 text-sm text-gray-700">
          <li>운영자가 공유한 fundId와 relayer URL 확인</li>
          <li>텔레그램 채팅방 초대 링크로 입장</li>
          <li>MoltBot 환경변수 설정(fundId, botId, bot key, role)</li>
          <li>역할별 실행 커맨드 실행(participant/strategy)</li>
          <li>채팅방에서 /status, /claims, /intent로 상태 확인</li>
        </ol>

        <div className="border-t border-gray-200 px-6 py-4 text-xs text-gray-500 sm:px-10">
          Bot write API에는 <code>x-bot-id</code>와 <code>x-bot-api-key</code>가 필요합니다.
        </div>
      </div>
    </div>
  );
}
