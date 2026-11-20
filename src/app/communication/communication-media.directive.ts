import { Directive, ElementRef, Input, inject } from '@angular/core';
@Directive({ selector: 'video[appMedia],audio[appMedia]', standalone: true })
export class CommunicationMediaDirective {
  private element = inject<ElementRef<HTMLMediaElement>>(ElementRef);
  @Input() set appMedia(stream: MediaStream | null) {
    const el = this.element.nativeElement;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }
}
