import { Component, inject, signal, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import {
  IonContent,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonBackButton,
} from '@ionic/angular';
import { CommunicationApiService } from './communication-api.service';
import { CommunicationRealtimeService } from './communication-realtime.service';
import { MobileSessionService } from './mobile-session.service';
import { MobilePushService } from './mobile-push.service';
import { CustomerTokenService } from '../services/customer-token.service';
import {
  Conversation,
  ChatMessage,
  AppNotice,
  CallHistory,
  MeetingListItem,
} from './communication.model';
@Component({
  selector: 'app-communication',
  standalone: true,
  imports: [
    FormsModule,
    DatePipe,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
  ],
  template: `<ion-header
      ><ion-toolbar
        ><ion-buttons slot="start"><ion-back-button defaultHref="/tabs/dashboard" /></ion-buttons
        ><ion-title>Comunicaciones</ion-title></ion-toolbar
      ></ion-header
    >
    <ion-content
      ><main>
        <nav aria-label="Comunicaciones">
          @for(item of sections;track item.id){<button
            [class.selected]="section() === item.id"
            (click)="select(item.id)"
          >
            {{ item.title }}</button
          >}
        </nav>
        <div class="connection" role="status">
          {{ realtime.connected() ? 'Conectado' : 'Conectando…' }}
          <button (click)="refresh()">Actualizar</button>
        </div>
        @if(error()){
        <p role="alert" class="error">{{ error() }}</p>
        } @if(section()==='chat'){ @if(!selected()){
        <h2>Mi oficina</h2>
        @for(person of office();track person.userId){
        <div class="row">
          <span>{{ person.displayName }} {{ person.isPrimaryPreparer ? '· preparador' : '' }}</span
          ><button (click)="startChat(person.userId)">Escribir</button
          ><button (click)="dial(person.userId, person.displayName, 'Audio')">Llamar</button>
        </div>
        }
        <h2>Conversaciones</h2>
        @for(chat of chats();track chat.id){<button class="conversation" (click)="open(chat)">
          <strong>{{ title(chat) }}</strong
          ><span>{{ chat.unreadCount ? chat.unreadCount + ' sin leer' : '' }}</span></button
        >} @if(!chats().length&&!busy()){
        <p>No hay conversaciones todavia. Tu oficina puede iniciar un chat contigo.</p>
        } @if(hasMoreChats()){<button (click)="moreChats()">Mas conversaciones</button>} }@else{
        <div class="row">
          <button (click)="closeChat()">Volver</button>
          <h2>{{ title(selected()!) }}</h2>
          <span role="status">{{ peerStatus() }}</span>
        </div>
        @if(peer();as p){
        <div class="row">
          <button (click)="dial(p.userId, p.displayName, 'Audio')">Llamada</button
          ><button (click)="dial(p.userId, p.displayName, 'Video')">Videollamada</button>
        </div>
        } @if(before()){<button (click)="older()">Mensajes anteriores</button>}
        <div class="messages" aria-live="polite">
          @for(message of messages();track message.id){
          <article [class.mine]="message.senderId === me()">
            <strong>{{ message.senderDisplayName }}</strong>
            <p>{{ message.isDeleted ? 'Mensaje eliminado' : message.body || 'Archivo adjunto' }}</p>
            @if(message.attachmentFileId && !message.isDeleted){
            <button (click)="download(message)">Abrir adjunto</button>
            }
            <small
              >{{ message.createdAtUtc | date : 'short' }}
              {{ message.isEdited ? '· editado' : '' }}</small
            >
          </article>
          }
        </div>
        @if(selected()?.isClosedForWriting){
        <p>Esta conversacion es de solo lectura.</p>
        }@else{
        <p role="status">{{ typingName() ? typingName() + ' está escribiendo…' : '' }}</p>
        @if(pendingAttachment){<button (click)="retryAttachment()" [disabled]="sending()">Reintentar envío del archivo</button>}
        <form class="chat-composer" (ngSubmit)="send()">
          @if(attachmentMenu()){
          <div class="composer-panel attachment-menu" role="group" aria-label="Tipos de adjuntos">
            @for(option of attachmentTypes; track option.label){
            <button type="button" (click)="filePicker.accept = option.accept; filePicker.click(); attachmentMenu.set(false)" [disabled]="sending()">
              <span aria-hidden="true">{{ option.icon }}</span>{{ option.label }}
            </button>}
          </div>}
          @if(emojiMenu()){
          <div class="composer-panel emoji-menu" role="group" aria-label="Seleccionar emoji">
            @for(emoji of emojis; track emoji){<button type="button" [attr.aria-label]="'Insertar ' + emoji" (click)="insertEmoji(emoji, messageInput)">{{ emoji }}</button>}
          </div>}
          <input #filePicker type="file" hidden (change)="attach($event)" />
          <div class="composer-input">
            <button type="button" class="composer-icon" aria-label="Emojis" [attr.aria-expanded]="emojiMenu()" (click)="emojiMenu.set(!emojiMenu()); attachmentMenu.set(false)">☺</button>
            <textarea #messageInput id="chat-body" name="body" aria-label="Mensaje" placeholder="Escribe un mensaje"
              [(ngModel)]="body" (ngModelChange)="typing()" (blur)="stopTyping()" maxlength="4000" rows="1"></textarea>
            <button type="button" class="composer-icon" aria-label="Adjuntar archivo" [attr.aria-expanded]="attachmentMenu()" [disabled]="sending()"
              (click)="attachmentMenu.set(!attachmentMenu()); emojiMenu.set(false)">
              <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"/><path d="m7 13 7-7"/></svg>
            </button>
            <button class="composer-send" type="submit" [disabled]="sending() || !body.trim()" [attr.aria-label]="sending() ? 'Enviando' : 'Enviar mensaje'">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m3 3 19 9-19 9 4-9-4-9Z"/><path d="M7 12h15"/></svg>
            </button>
          </div>
          @if(sending()){<small role="status">Enviando…</small>}
        </form>
        } } } @if(section()==='calls'){
        <h2>Llamadas</h2>
        @for(call of history();track call.id){
        <div class="row">
          <div>
            <strong>{{ call.counterpart.displayName || 'Oficina' }}</strong>
            <p>
              {{ call.kind === 'Video' ? 'Video' : 'Audio' }} · {{ call.status }} ·
              {{ call.ringingAtUtc | date : 'short' }}
            </p>
          </div>
          <button (click)="dial(call.counterpart.userId, call.counterpart.displayName, call.kind)">
            Volver a llamar
          </button>
        </div>
        } @if(hasMoreCalls()){<button (click)="moreCalls()">Mas llamadas</button>} }
        @if(section()==='meetings'){
        <h2>Mis reuniones</h2>
        @for(meeting of meetings();track meeting.id){
        <div class="row">
          <div>
            <strong>{{ meeting.title }}</strong>
            <p>{{ meeting.scheduledForUtc | date : 'short' }} · {{ meeting.status }}</p>
          </div>
          <button (click)="joinId = meeting.id; join()">Entrar</button>
        </div>
        } @if(hasMoreMeetings()){<button (click)="moreMeetings()">Mas reuniones</button>}
        <form (ngSubmit)="join()">
          <h3>Entrar con enlace, codigo o ID</h3>
          <label for="meeting-id">Enlace o identificador de reunion</label
          ><input id="meeting-id" name="meetingId" [(ngModel)]="joinId" required /><label
            for="passcode"
            >Codigo de acceso (si se solicita)</label
          ><input id="passcode" name="passcode" type="password" [(ngModel)]="passcode" /><label
            ><input type="checkbox" name="video" [(ngModel)]="joinVideo" /> Entrar con camara</label
          ><button type="submit">Entrar a la reunion</button>
        </form>
        } @if(section()==='notifications'){
        <h2>Notificaciones</h2>
        <p>{{ push.statusText() }}</p>
        <button (click)="enablePush()">Activar notificaciones de Android</button> @for(notice of
        notices();track notice.id){<button
          class="notice"
          [class.unread]="!notice.readAtUtc"
          (click)="openNotice(notice)"
        >
          <strong>{{ notice.title }}</strong>
          <p>{{ notice.body }}</p>
          <small>{{ notice.createdAtUtc | date : 'short' }}</small></button
        >} @if(hasMoreNotices()){<button (click)="moreNotices()">Mas notificaciones</button>} }
        @if(busy()){
        <p role="status">Cargando…</p>
        }
      </main></ion-content
    >`,
  styles: [
    `
      :host { color: var(--ion-text-color); }
      button:disabled { opacity: .55; }
      .chat-composer { position: sticky; bottom: 0; z-index: 3; background: var(--ion-background-color); padding: 10px 0 max(10px, env(safe-area-inset-bottom)); }
      .composer-input { display: flex; align-items: flex-end; gap: 2px; border: 1px solid var(--taxpro-border-color, #cbd5e1); border-radius: 28px; padding: 5px; background: var(--taxpro-card-background, #fff); box-shadow: 0 3px 16px #0f172a0d; }
      .composer-input textarea { flex: 1; min-width: 0; border: 0; outline: 0; resize: none; min-height: 42px; max-height: 120px; padding: 12px 5px; line-height: 20px; background: transparent; field-sizing: content; }
      .composer-input .composer-icon { border: 0; padding: 8px; background: transparent; border-radius: 50%; width: 42px; min-width: 42px; height: 44px; display: grid; place-items: center; font-size: 27px; color: var(--taxpro-text-secondary); }
      .composer-input .composer-send { border: 0; border-radius: 50%; background: #18766c; color: #fff; width: 44px; min-width: 44px; height: 44px; padding: 10px; }
      .composer-panel { border: 1px solid var(--taxpro-border-color); background: var(--taxpro-card-background); border-radius: 20px; padding: 12px; box-shadow: 0 6px 24px #0f172a14; }
      .attachment-menu { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
      .attachment-menu button { border: 0; background: transparent; font-size: 12px; padding: 8px 2px; display: grid; gap: 7px; justify-items: center; }
      .attachment-menu span { font-size: 25px; background: var(--ion-background-color); padding: 10px; border-radius: 16px; }
      .emoji-menu { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 3px; max-height: 220px; overflow: auto; }
      .emoji-menu button { border: 0; background: transparent; font-size: 25px; padding: 6px; }
      button:focus-visible, textarea:focus-visible { outline: 2px solid #25847a; outline-offset: 2px; }
      main {
        max-width: 760px;
        margin: auto;
        padding: 16px 16px calc(env(safe-area-inset-bottom, 0px) + 24px);
      }
      nav {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 12px;
        position: sticky;
        top: 0;
        background: var(--ion-background-color, #fff);
        z-index: 2;
      }
      button {
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 12px;
        background: var(--ion-background-color, #fff);
        color: var(--ion-text-color, #0f172a);
        min-height: 44px;
      }
      button.selected {
        background: #1a365d;
        color: white;
      }
      .connection {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        color: #64748b;
      }
      .error {
        background: #fef2f2;
        color: #991b1b;
        padding: 12px;
        border-radius: 10px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: space-between;
        border-bottom: 1px solid #e2e8f0;
        padding: 12px 0;
        flex-wrap: wrap;
      }
      .row p {
        font-size: 13px;
        color: #64748b;
      }
      .conversation,
      .notice {
        display: block;
        width: 100%;
        text-align: left;
        margin: 10px 0;
      }
      .conversation span {
        float: right;
      }
      .unread {
        border-left: 4px solid #2563eb;
      }
      .messages {
        min-height: 20vh;
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 16px 0;
      }
      .messages article {
        box-shadow: 0 2px 8px #0f172a0a;
        align-self: flex-start;
        max-width: 90%;
        background: #f1f5f9;
        color: #0f172a;
        padding: 12px;
        border-radius: 16px 16px 16px 4px;
        overflow-wrap: anywhere;
      }
      .messages .mine {
        border-radius: 16px 16px 4px 16px;
        align-self: flex-end;
        background: #dbeafe;
      }
      .messages p {
        white-space: pre-wrap;
      }
      .messages small {
        color: #475569;
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 18px 0;
      }
      input,
      textarea {
        border: 1px solid #cbd5e1;
        padding: 12px;
        border-radius: 10px;
        background: var(--ion-background-color, #fff);
        color: inherit;
      }
      h2 {
        font-size: 20px;
      }
    `,
  ],
})
export class CommunicationPage implements OnDestroy {
  readonly realtime = inject(CommunicationRealtimeService);
  readonly api = inject(CommunicationApiService);
  readonly calls = inject(MobileSessionService);
  readonly push = inject(MobilePushService);
  private tokens = inject(CustomerTokenService);
  private route = inject(ActivatedRoute);
  readonly sections = [
    { id: 'chat', title: 'Chat' },
    { id: 'calls', title: 'Llamadas' },
    { id: 'meetings', title: 'Reuniones' },
    { id: 'notifications', title: 'Avisos' },
  ];
  readonly section = signal('chat');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly sending = signal(false);
  readonly chats = signal<Conversation[]>([]);
  readonly selected = signal<Conversation | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly before = signal<string | null>(null);
  readonly history = signal<CallHistory[]>([]);
  readonly meetings = signal<MeetingListItem[]>([]);
  readonly notices = signal<AppNotice[]>([]);
  readonly office = signal<{ userId: string; displayName: string; isPrimaryPreparer: boolean }[]>(
    []
  );
  readonly hasMoreChats = signal(false);
  readonly hasMoreCalls = signal(false);
  readonly hasMoreMeetings = signal(false);
  readonly hasMoreNotices = signal(false);
  readonly attachmentMenu = signal(false);
  readonly emojiMenu = signal(false);
  readonly attachmentTypes = [
    {label: 'Imágenes', icon: '🖼️', accept: 'image/*'},
    {label: 'Documentos', icon: '📄', accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.odt,.ods'},
    {label: 'Videos', icon: '🎬', accept: 'video/*'},
    {label: 'Audios', icon: '🎧', accept: 'audio/*'},
  ];
  readonly emojis = ['😀','😃','😊','🥰','😂','🤣','😉','😍','🤔','😎','😢','🙏','👍','👎','👏','🙌','👋','💪','❤️','💙','🎉','✅','🚗','📍','📄','💬','📞','🕐','💰','✨'];
  insertEmoji(emoji: string, input: HTMLTextAreaElement) {
    const start = input.selectionStart ?? this.body.length;
    const end = input.selectionEnd ?? start;
    if (this.body.length - (end - start) + emoji.length > 4000) return;
    this.body = this.body.slice(0, start) + emoji + this.body.slice(end);
    input.value = this.body;
    input.focus(); input.setSelectionRange(start + emoji.length, start + emoji.length);
    this.typing();
  }
  readonly presence = signal<Record<string, string>>({});
  readonly typingName = signal('');
  private typingTimer?: ReturnType<typeof setTimeout>;
  private remoteTypingTimer?: ReturnType<typeof setTimeout>;
  private lastTyping = 0;
  pendingAttachment: { conversationId: string; fileId: string; clientKey: string } | null = null;
  closeChat() { this.attachmentMenu.set(false); this.emojiMenu.set(false); this.stopTyping(); this.typingName.set(''); this.selected.set(null); }
  ionViewWillLeave() { this.stopTyping(); this.typingName.set(''); }
  peerStatus() {
    if (!this.realtime.connected()) return 'Sin conexión';
    const status = this.presence()[this.peer()?.userId ?? ''];
    return status === 'Online' ? 'En línea' : status === 'Busy' ? 'Ocupado' : status === 'Offline' ? 'Desconectado' : 'Consultando estado…';
  }
  typing() {
    const id = this.selected()?.id;
    if (!id) return;
    if (!this.body.trim()) { this.stopTyping(); return; }
    if (Date.now() - this.lastTyping > 2500) {
      this.realtime.emitNoAck('chat.typing.start', {conversationId: id}); this.lastTyping = Date.now();
    }
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => this.stopTyping(), 3000);
  }
  stopTyping() {
    clearTimeout(this.typingTimer); this.lastTyping = 0;
    if (this.selected()) this.realtime.emitNoAck('chat.typing.stop', {conversationId: this.selected()!.id});
  }
  async attach(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; const chat = this.selected();
    input.value = '';
    if (!file || !chat || this.sending() || chat.isClosedForWriting) return;
    if (this.pendingAttachment) { this.error.set('Reintenta primero el archivo pendiente.'); return; }
    this.sending.set(true);
    try {
      const fileId = await this.api.uploadAttachment(chat.id, file);
      this.pendingAttachment = {conversationId: chat.id, fileId, clientKey: crypto.randomUUID()};
    } catch(e) { this.showError(e); } finally { this.sending.set(false); }
    if (this.pendingAttachment) await this.retryAttachment();
  }
  async retryAttachment() {
    const attachment = this.pendingAttachment;
    if (!attachment || this.sending()) return;
    this.sending.set(true);
    try {
      const result = await this.api.sendAttachment(attachment.conversationId, attachment.fileId, attachment.clientKey);
      if (this.selected()?.id === attachment.conversationId) this.messages.update(rows => [...rows.filter(m => m.id !== result.message.id), result.message]);
      this.pendingAttachment = null;
    } catch(e) { this.showError(e); } finally { this.sending.set(false); }
  }
  async download(message: ChatMessage) {
    try {
      const {downloadUrl} = await this.api.attachmentUrl(message.conversationId, message.attachmentFileId!);
      const url = new URL(downloadUrl);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Enlace de archivo inválido.');
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({url: url.href});
    } catch(e) { this.showError(e); }
  }
  body = '';
  joinId = '';
  passcode = '';
  joinVideo = true;
  private pages = { chat: 1, calls: 1, meetings: 1, notifications: 1 };
  private pendingMessage: { body: string; clientKey: string; conversationId: string } | null = null;
  private subscriptions = [
    this.realtime.on<{userId: string; status: string}>('chat.presence.changed').subscribe(p => this.presence.update(rows => ({...rows, [p.userId]: p.status}))),
    this.realtime.on<{conversationId: string; userId: string; displayName: string}>('chat.typing.started').subscribe(p => {
      if (p.conversationId !== this.selected()?.id || p.userId === this.me()) return;
      this.typingName.set(p.displayName); clearTimeout(this.remoteTypingTimer);
      this.remoteTypingTimer = setTimeout(() => this.typingName.set(''), 6000);
    }),
    this.realtime.on<{conversationId: string}>('chat.typing.stopped').subscribe(p => { if (p.conversationId === this.selected()?.id) this.typingName.set(''); }),
    this.realtime.on<ChatMessage>('chat.message.new').subscribe((m) => {
      if (m.conversationId === this.selected()?.id) {
        this.messages.update((rows) =>
          [...rows.filter((x) => x.id !== m.id), m].sort((a, b) =>
            a.createdAtUtc.localeCompare(b.createdAtUtc)
          )
        );
        void this.api.markRead(m.conversationId, m.id).catch(() => undefined);
      }
      void this.reloadChats();
    }),
    this.realtime.reconnected$.subscribe(() => void this.refresh()),
    this.realtime.on('notification.received').subscribe(() => void this.reloadNotices()),
    this.realtime.accountChanged$.subscribe(() => {
      this.presence.set({}); this.typingName.set(''); this.pendingAttachment = null;
      this.chats.set([]);
      this.messages.set([]);
      this.notices.set([]);
      this.selected.set(null);
      this.stopTyping();
      this.body = '';
      this.pendingMessage = null;
    }),
  ];
  constructor() {
    this.subscriptions.push(
      this.route.queryParamMap.subscribe((q) => {
        const tab = q.get('section');
        if (tab && this.sections.some((x) => x.id === tab)) this.section.set(tab);
        const mid = q.get('meetingId');
        if (mid) {
          this.joinId = mid;
          this.section.set('meetings');
        }
        const cid = q.get('conversationId');
        if (cid)
          void this.reloadChats().then(() => {
            const chat = this.chats().find((c) => c.id === cid);
            if (chat) void this.open(chat);
          });
      })
    );
  }
  ngOnDestroy() {
    this.stopTyping(); clearTimeout(this.remoteTypingTimer);
    this.subscriptions.forEach((s) => s.unsubscribe());
  }
  ionViewWillEnter() {
    void this.refresh();
  }
  me() {
    return this.tokens.decodeToken()?.sub;
  }
  title(c: Conversation) {
    return (
      c.title ||
      c.participants
        .filter((p) => p.userId !== this.me())
        .map((p) => p.displayName)
        .join(', ') ||
      'Mi oficina'
    );
  }
  peer() {
    const c = this.selected();
    return c?.kind === 'Direct' ? c.participants.find((p) => p.userId !== this.me()) : undefined;
  }
  async select(section: string) {
    this.section.set(section);
    this.error.set(null);
    await this.refresh();
  }
  async refresh() {
    this.busy.set(true);
    try {
      await this.realtime.ready();
      if (this.section() === 'chat') {
        await this.reloadChats();
        if (this.selected()) await this.open(this.selected()!);
      } else if (this.section() === 'calls') {
        const p = await this.api.history();
        this.history.set(p.items);
        this.pages.calls = 1;
        this.hasMoreCalls.set(p.totalCount > p.items.length);
      } else if (this.section() === 'meetings') {
        const p = await this.api.meetings();
        this.meetings.set(p.items);
        this.pages.meetings = 1;
        this.hasMoreMeetings.set(p.totalCount > p.items.length);
      } else await this.reloadNotices();
    } catch (e) {
      this.showError(e);
    } finally {
      this.busy.set(false);
    }
  }
  private async reloadChats() {
    try {
      const p = await this.api.conversations();
      this.chats.set(p.items);
      this.pages.chat = 1;
      this.hasMoreChats.set(p.totalCount > p.items.length);
      this.office.set(await this.api.myOffice());
    } catch (e) {
      this.showError(e);
    }
  }
  private async reloadNotices() {
    try {
      const p = await this.api.notices();
      this.notices.set(p.items);
      this.pages.notifications = 1;
      this.hasMoreNotices.set(p.totalCount > p.items.length);
    } catch (e) {
      this.showError(e);
    }
  }
  async open(c: Conversation) {
    try {
      const p = await this.api.messages(c.id);
      this.stopTyping(); this.typingName.set('');
      this.selected.set(c);
      this.realtime.emitNoAck('chat.presence.query', {userIds: c.participants.filter(p => p.userId !== this.me()).map(p => p.userId)});
      this.messages.set([...p.items].sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc)));
      this.before.set(p.nextBeforeUtc);
      this.pendingMessage = null;
      this.body = '';
      const last = this.messages()[this.messages().length - 1];
      if (last) await this.api.markRead(c.id, last.id);
    } catch (e) {
      this.showError(e);
    }
  }
  async older() {
    try {
      const p = await this.api.messages(this.selected()!.id, this.before()!);
      this.messages.update((rows) =>
        [...p.items, ...rows]
          .filter((x, i, a) => a.findIndex((m) => m.id === x.id) === i)
          .sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc))
      );
      this.before.set(p.nextBeforeUtc);
    } catch (e) {
      this.showError(e);
    }
  }
  async send() {
    const chat = this.selected();
    const body = this.body.trim();
    if (!chat || !body || this.sending()) return;
    if (
      this.pendingMessage &&
      (this.pendingMessage.body !== body || this.pendingMessage.conversationId !== chat.id)
    ) {
      this.error.set('Reintenta primero el mensaje pendiente sin cambiar su contenido.');
      return;
    }
    this.pendingMessage ??= { body, conversationId: chat.id, clientKey: crypto.randomUUID() };
    this.sending.set(true);
    try {
      const result = await this.api.send(chat.id, body, this.pendingMessage.clientKey);
      this.messages.update((rows) => [
        ...rows.filter((x) => x.id !== result.message.id),
        result.message,
      ]);
      this.stopTyping();
      this.body = '';
      this.pendingMessage = null;
      await this.reloadChats();
    } catch (e) {
      this.showError(e);
    } finally {
      this.sending.set(false);
    }
  }
  async startChat(userId: string) {
    try {
      await this.api.startDirect(userId);
      await this.reloadChats();
      const chat = this.chats().find(
        (c) => c.kind === 'Direct' && c.participants.some((p) => p.userId === userId)
      );
      if (chat) await this.open(chat);
    } catch (e) {
      this.showError(e);
    }
  }
  async dial(userId: string, title: string, kind: 'Audio' | 'Video') {
    try {
      await this.calls.dial(userId, title, kind, this.selected()?.id);
    } catch (e) {
      this.showError(e);
    }
  }
  async join() {
    try {
      const input = this.joinId.trim();
      let id = input;
      let token: string | undefined;
      if (input.includes('://')) {
        const url = new URL(input);
        id =
          url.searchParams.get('meetingId') ?? url.pathname.split('/').filter(Boolean).pop() ?? '';
        token =
          url.searchParams.get('invitationToken') ?? url.searchParams.get('token') ?? undefined;
      }
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        if (/^[A-Za-z0-9-]{4,32}$/.test(id)) id = (await this.api.meetingCode(id)).meetingId;
        else throw new Error('Selecciona una reunion o introduce su codigo o enlace.');
      }
      await this.calls.join(id, this.passcode || undefined, token, this.joinVideo);
    } catch (e) {
      this.showError(e);
    }
  }
  async openNotice(n: AppNotice) {
    try {
      await this.api.noticeRead(n.id);
      this.notices.update((rows) =>
        rows.map((x) => (x.id === n.id ? { ...x, readAtUtc: new Date().toISOString() } : x))
      );
      const meetingId = n.resourceContext?.['meetingId'];
      if (meetingId) {
        this.joinId = meetingId;
        this.section.set('meetings');
      } else if (n.resourceType === 'conversation') {
        this.section.set('chat');
        await this.reloadChats();
        const chat = this.chats().find((c) => c.id === n.resourceId);
        if (chat) await this.open(chat);
      } else if (n.resourceType === 'call' || n.resourceContext?.['callId']) {
        await this.select('calls');
      }
    } catch (e) {
      this.showError(e);
    }
  }
  async enablePush() {
    try {
      await this.push.enable();
    } catch (e) {
      this.showError(e);
    }
  }
  async moreChats() {
    try {
      const p = await this.api.conversations(++this.pages.chat);
      this.chats.update((x) => [...x, ...p.items]);
      this.hasMoreChats.set(this.chats().length < p.totalCount);
    } catch (e) {
      --this.pages.chat;
      this.showError(e);
    }
  }
  async moreCalls() {
    try {
      const p = await this.api.history(++this.pages.calls);
      this.history.update((x) => [...x, ...p.items]);
      this.hasMoreCalls.set(this.history().length < p.totalCount);
    } catch (e) {
      --this.pages.calls;
      this.showError(e);
    }
  }
  async moreMeetings() {
    try {
      const p = await this.api.meetings(++this.pages.meetings);
      this.meetings.update((x) => [...x, ...p.items]);
      this.hasMoreMeetings.set(this.meetings().length < p.totalCount);
    } catch (e) {
      --this.pages.meetings;
      this.showError(e);
    }
  }
  async moreNotices() {
    try {
      const p = await this.api.notices(++this.pages.notifications);
      this.notices.update((x) => [...x, ...p.items]);
      this.hasMoreNotices.set(this.notices().length < p.totalCount);
    } catch (e) {
      --this.pages.notifications;
      this.showError(e);
    }
  }
  private showError(e: unknown) {
    this.error.set(
      (e as { error?: { message?: string } })?.error?.message ??
        (e instanceof Error ? e.message : 'No se pudo completar la accion.')
    );
  }
}
