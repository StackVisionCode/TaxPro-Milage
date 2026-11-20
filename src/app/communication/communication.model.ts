export type CallKind = 'Audio' | 'Video';
export interface Conversation {
  id: string;
  kind: string;
  title: string | null;
  unreadCount: number;
  isClosedForWriting?: boolean;
  participants: {
    userId: string;
    displayName: string;
    isPrimaryPreparer: boolean;
    actorType?: string;
  }[];
  lastMessageAtUtc: string | null;
}
export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderDisplayName: string;
  body: string | null;
  createdAtUtc: string;
  isDeleted: boolean;
  attachmentFileId?: string | null;
  isEdited?: boolean;
}
export interface AppNotice {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAtUtc: string;
  readAtUtc: string | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceContext: Record<string, string>;
  metadata: Record<string, unknown>;
}
export interface IncomingCall {
  callId: string;
  callerUserId: string;
  callerDisplayName: string;
  calleeUserId: string;
  kind: CallKind;
  conversationId: string | null;
  ringingAtUtc: string;
}
export interface CallHistory {
  id: string;
  kind: CallKind;
  status: string;
  durationSeconds: number | null;
  direction: string;
  counterpart: { userId: string; displayName: string };
  ringingAtUtc: string;
  conversationId: string | null;
}
export interface MeetingListItem {
  id: string;
  title: string;
  status: string;
  scheduledForUtc: string | null;
  shortCode: string;
}
export interface AttachmentMetaDto {
  fileId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  [key: string]: unknown;
}
export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalCount: number;
}
export function accountKey(
  c: { tenant_id: string; customer_id?: string; sub: string } | null
): string | null {
  return c ? `${c.tenant_id}:${c.customer_id ?? ''}:${c.sub}` : null;
}
