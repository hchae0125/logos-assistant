// app/components/MeetingCard.tsx
'use client';

import { useState } from 'react';
import { PendingMeeting } from '../types';

interface MeetingCardProps {
    meeting: PendingMeeting;
    isConfirmLoading: boolean;
    onConfirm: (threadId: string) => void;
    onArchive: (threadId: string) => void;
    onEmailSent: (threadId: string) => void;
    isArchivedView?: boolean;
}

export default function MeetingCard({
    meeting,
    isConfirmLoading,
    onConfirm,
    onArchive,
    onEmailSent,
    isArchivedView = false
}: MeetingCardProps) {
    const [replyText, setReplyText] = useState<string>(meeting.suggested_reply || '');
    const [isEmailSending, setIsEmailSending] = useState<boolean>(false);

    // 캘린더 상태 파싱
    const calStatus = meeting.calendar_status;

    const getBadgeColor = (type: string): string => {
        switch (type) {
            case 'CHURCH': return 'bg-blue-50 text-blue-700 border-blue-200';
            case 'PSYCH': return 'bg-purple-50 text-purple-700 border-purple-200';
            case 'STUDY': return 'bg-amber-50 text-amber-700 border-amber-200';
            default: return 'bg-gray-50 text-gray-700 border-gray-200';
        }
    };

    const handleSendEmailReply = async (actionType: 'confirm' | 'negotiate') => {
        if (!replyText.trim()) return alert('본문을 입력해 주세요.');

        const confirmMsg = actionType === 'confirm'
            ? '이 메일을 보내고 일정을 확정/종료할까요? (대시보드에서 제외)'
            : '시간 조율 메일을 보낼까요? (대시보드에 [조율중] 상태로 유지)';

        if (!window.confirm(confirmMsg)) return;

        setIsEmailSending(true);
        try {
            const res = await fetch('/api/reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    threadId: meeting.threadId,
                    replyText: replyText,
                    actionType: actionType,
                    eventDetails: {
                        title: meeting.title,
                        estimated_start: meeting.estimated_start,
                        duration: meeting.duration || "1h",
                        location: meeting.location || "",
                        calendar_type: meeting.calendar_type,
                        description: meeting.description || "",
                        meeting_timezone: meeting.meeting_timezone || ""
                    }
                }),
            });

            const result = await res.json();
            if (result.success) {
                alert('🚀 메일이 성공적으로 발송되었습니다!');
                if (actionType === 'confirm') {
                    onEmailSent(meeting.threadId);
                } else {
                    alert('이 카드는 상대방의 회신을 기다리기 위해 [조율 중] 상태로 유지됩니다.');
                    window.location.reload();
                }
            }
        } catch (error) {
            alert('통신 에러 발생');
        } finally {
            setIsEmailSending(false);
        }
    };

    return (
        <div className={`bg-white border rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 flex flex-col overflow-hidden ${isArchivedView ? 'opacity-75 border-dashed border-slate-300' : 'border-slate-200'}`}>

            {/* 카드 제목부 */}
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-start gap-3">
                <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                        <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-md border ${getBadgeColor(meeting.calendar_type)}`}>
                            {meeting.calendar_type}
                        </span>
                        {isArchivedView && (
                            <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded uppercase">ARCHIVED</span>
                        )}
                    </div>
                    <h2 className="text-base font-bold text-slate-900 line-clamp-1 mt-1.5">{meeting.title || meeting.subject}</h2>
                </div>
            </div>

            {/* 일정 메타 상세 내역 */}
            <div className="p-5 space-y-4 flex-1 text-sm">

                {/* 제안된 일시 파트 */}
                <div className="flex items-start space-x-3">
                    <span className="text-slate-400 w-5 text-center mt-0.5">📅</span>
                    <div className="flex-1">
                        <span className="font-semibold block text-slate-400 text-xs uppercase tracking-wider">제안된 일시</span>
                        <p className="text-slate-700 font-medium mt-0.5">
                            {meeting.proposed_dates ? (
                                meeting.proposed_dates
                            ) : meeting.estimated_start ? (
                                // 💡 proposed_dates가 비어있으면 estimated_start(ISO 포맷)를 예쁘게 파싱해서 출력
                                new Date(meeting.estimated_start).toLocaleString('ko-KR', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                    weekday: 'long',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    hour12: false
                                })
                            ) : (
                                "본문 내용 확인 필요"
                            )}
                        </p>

                        {/* 🟢 캘린더 실시간 분석 결과 UI 피드백 영역 */}
                        {!isArchivedView && calStatus && (
                            <div className="mt-2">
                                {calStatus.has_conflict ? (
                                    <div className="bg-rose-50 border border-rose-100 rounded-xl p-3 text-xs text-rose-800 space-y-1.5">
                                        <div className="flex items-center space-x-1 font-semibold">
                                            <span>⚠️ 캘린더 충돌 감지됨</span>
                                        </div>
                                        <p className="text-rose-600">
                                            해당 시간에 이미 <span className="font-bold underline">[{calStatus.conflicting_event_title}]</span> 일정이 있습니다.
                                        </p>
                                        {calStatus.alternative_suggestion && (
                                            <div className="pt-1.5 border-t border-rose-200/60 text-[11px] text-slate-600">
                                                <span className="font-bold text-slate-700 block mb-0.5">💡 추천 조율 시간대:</span>
                                                <span className="bg-white/80 border border-slate-200 px-1.5 py-0.5 rounded text-slate-800 font-mono inline-block">
                                                    {calStatus.alternative_suggestion}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="inline-flex items-center space-x-1.5 bg-emerald-50 border border-emerald-100 text-emerald-800 px-2.5 py-1 rounded-lg text-xs font-medium">
                                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                        <span>이 시간대에 내 캘린더가 비어 있습니다 (확정 가능)</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {meeting.location && (
                    <div className="flex items-start space-x-3">
                        <span className="text-slate-400 w-5 text-center mt-0.5">📍</span>
                        <div>
                            <span className="font-semibold block text-slate-400 text-xs uppercase tracking-wider">장소</span>
                            <p className="text-slate-600 mt-0.5 line-clamp-1">{meeting.location}</p>
                        </div>
                    </div>
                )}

                {/* AI Suggested Reply 에디터 구역 */}
                {meeting.suggested_reply && !isArchivedView && (
                    <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col flex-1">
                        <div className="flex justify-between items-center mb-1.5">
                            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase">AI Suggested Reply (수정 가능)</span>
                        </div>
                        <textarea
                            className="w-full text-xs text-slate-700 bg-slate-50/80 border border-slate-200 rounded-xl p-3 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition font-mono leading-relaxed resize-none flex-1 min-h-[120px]"
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder="상대방에게 보낼 영문 답장 내용을 입력하세요..."
                        />
                    </div>
                )}
            </div>

            {/* 액션 버튼 섹션 */}
            {!isArchivedView && (
                <div className="p-5 bg-slate-50/70 border-t border-slate-100 flex flex-col gap-3">

                    {/* 1. 메인 액션: 확정 및 종료 */}
                    <button
                        onClick={() => handleSendEmailReply('confirm')}
                        disabled={isConfirmLoading || isEmailSending}
                        className="w-full bg-slate-900 hover:bg-slate-800 text-white py-3 px-4 rounded-xl text-xs font-semibold tracking-wide shadow-sm hover:shadow transition-all duration-200 transform hover:-translate-y-0.5 disabled:opacity-40 disabled:transform-none flex items-center justify-center space-x-2"
                    >
                        <span>✉️ 확정 메일 발송 및 일정 종료</span>
                    </button>

                    {/* 2. 서브 액션 그룹: 캘린더 등록 및 시간 조율 */}
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => onConfirm(meeting.threadId)}
                            disabled={isConfirmLoading || isEmailSending || calStatus?.has_conflict}
                            className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/80 font-medium text-xs py-2.5 px-3 rounded-xl shadow-xs transition-all duration-200 transform hover:-translate-y-0.5 disabled:opacity-40 disabled:transform-none flex items-center justify-center space-x-1.5"
                        >
                            {isConfirmLoading ? (
                                <>
                                    <svg className="animate-spin h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    <span>등록 중...</span>
                                </>
                            ) : (
                                <span>🗓️ 구글 캘린더 등록</span>
                            )}
                        </button>

                        <button
                            onClick={() => handleSendEmailReply('negotiate')}
                            disabled={isConfirmLoading || isEmailSending}
                            className={`py-2.5 px-3 rounded-xl text-xs font-medium shadow-xs transition-all duration-200 transform hover:-translate-y-0.5 disabled:opacity-40 disabled:transform-none flex items-center justify-center space-x-1.5 ${calStatus?.has_conflict
                                    ? 'bg-amber-500 hover:bg-amber-600 text-white border border-transparent font-semibold'
                                    : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/80'
                                }`}
                        >
                            <span>{calStatus?.has_conflict ? '🔄 충돌 해결 메일 제안' : '🔄 시간 조율 제안'}</span>
                        </button>
                    </div>

                    {/* 3. 로우 프라이오리티 텍스트 링크: 패스 기능 */}
                    <div className="flex justify-center mt-1">
                        <button
                            onClick={() => onArchive(meeting.threadId)}
                            disabled={isConfirmLoading || isEmailSending}
                            className="text-slate-400 hover:text-red-500 text-[11px] font-medium tracking-tight transition-colors duration-150 underline underline-offset-4 decoration-slate-200 hover:decoration-red-200"
                        >
                            이 일정 건너뛰기 (보관함으로 이동)
                        </button>
                    </div>

                </div>
            )}

        </div>
    );
}