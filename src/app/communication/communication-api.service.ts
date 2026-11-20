import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { CommunicationRealtimeService } from './communication-realtime.service';
import {
  AppNotice,
  CallHistory,
  ChatMessage,
  Conversation,
  MeetingListItem,
  Page,
} from './communication.model';
import { MediaPolicyDto } from './media/media-policy.model';
@Injectable({ providedIn: 'root' })
export class CommunicationApiService {
  private http = inject(HttpClient);
  private realtime = inject(CommunicationRealtimeService);
  private base = environment.apiUrl + '/communication';
  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const scope = this.realtime.scope();
    const data = await firstValueFrom(this.http.get<T>(this.base + path, { params }));
    if (this.realtime.scope() !== scope) throw new Error('La cuenta cambio.');
    return data;
  }
  conversations(page = 1) {
    return this.get<Page<Conversation>>('/conversations', {
      page,
      size: 30,
      kinds: 'Direct,Group',
    });
  }
  messages(id: string, before?: string) {
    return this.get<{ items: ChatMessage[]; nextBeforeUtc: string | null }>(
      '/conversations/' + encodeURIComponent(id) + '/messages',
      { take: 50, ...(before ? { before } : {}) }
    );
  }
  send(id: string, body: string, clientKey: string) {
    return this.realtime.command<{ message: ChatMessage }>('chat.message.send', {
      conversationId: id,
      body,
      clientKey,
    });
  }
  async uploadAttachment(id: string, file: File) {
    const url = this.base + '/conversations/' + encodeURIComponent(id) + '/attachments';
    const scope = this.realtime.scope();
    const upload = await firstValueFrom(this.http.post<{fileId: string; uploadUrl: string; formData: Record<string,string>}>(url + '/upload', {
      originalName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size,
    }));
    const form = new FormData();
    Object.entries(upload.formData).forEach(([k,v]) => form.append(k,v));
    form.append('file', file);
    const response = await fetch(upload.uploadUrl, { method: 'POST', body: form });
    if (!response.ok) throw new Error('No se pudo subir el archivo.');
    await firstValueFrom(this.http.post(url + '/' + upload.fileId + '/complete', {}));
    if (this.realtime.scope() !== scope) throw new Error('La cuenta cambio.');
    return upload.fileId;
  }
  attachmentUrl(id: string, fileId: string) {
    return firstValueFrom(this.http.post<{downloadUrl: string}>(this.base + '/conversations/' + encodeURIComponent(id) + '/attachments/' + encodeURIComponent(fileId) + '/download-url', {}));
  }
  sendAttachment(conversationId: string, attachmentFileId: string, clientKey: string) {
    return this.realtime.command<{message: ChatMessage}>('chat.message.send', {conversationId, attachmentFileId, clientKey});
  }
  startDirect(recipientUserId: string) {
    return this.realtime.command<{ conversationId: string }>('chat.conversation.start_direct', {
      recipientUserId,
      clientKey: crypto.randomUUID(),
    });
  }
  markRead(conversationId: string, upToMessageId: string) {
    return this.realtime.command('chat.message.mark_read', {
      conversationId,
      lastReadMessageId: upToMessageId,
      clientKey: crypto.randomUUID(),
    });
  }
  history(page = 1) {
    return this.get<Page<CallHistory>>('/calls', { page, size: 30 });
  }
  meetings(page = 1) {
    return this.get<Page<MeetingListItem>>('/meetings', { page, size: 30, scope: 'upcoming' });
  }
  notices(page = 1) {
    return this.get<Page<AppNotice>>('/notifications', { page, size: 30 });
  }
  noticeRead(id: string) {
    return firstValueFrom(
      this.http.post(this.base + '/notifications/' + encodeURIComponent(id) + '/read', {})
    );
  }
  ice() {
    return this.get<{ iceServers: RTCIceServer[]; expiresAtUtc: string }>('/webrtc/ice');
  }
  policy() {
    return this.get<MediaPolicyDto>('/media-policy');
  }
  myOffice() {
    return this.get<{ userId: string; displayName: string; isPrimaryPreparer: boolean }[]>(
      '/directory/my-office'
    );
  }
  meetingCode(code: string) {
    return this.get<{ meetingId: string }>('/meetings/code/' + encodeURIComponent(code));
  }
  callDetail(id: string) {
    return this.get<CallHistory>('/calls/' + encodeURIComponent(id));
  }
}
