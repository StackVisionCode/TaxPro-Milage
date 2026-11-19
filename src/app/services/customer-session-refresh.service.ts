import { HttpBackend, HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { finalize, map, Observable, shareReplay, tap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { CustomerTokenService } from './customer-token.service';

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

@Injectable({ providedIn: 'root' })
export class CustomerSessionRefreshService {
  private tokenService = inject(CustomerTokenService);
  private http = new HttpClient(inject(HttpBackend));
  private refreshInFlight?: Observable<string>;
  private refreshForToken?: string;

  refreshAccessToken(): Observable<string> {
    const refreshToken = this.tokenService.refreshToken;
    if (this.refreshInFlight && this.refreshForToken === refreshToken) return this.refreshInFlight;
    if (!refreshToken) {
      return throwError(() => new Error('No refresh token is available.'));
    }

    this.refreshForToken = refreshToken;
    this.refreshInFlight = this.http
      .post<RefreshResponse>(`${environment.apiUrl}${environment.endpoints.refreshToken}`, {
        refreshToken,
      })
      .pipe(
        tap((tokens) => {
          if (this.tokenService.refreshToken !== refreshToken)
            throw new Error('La cuenta cambio durante la renovacion de sesion.');
          this.tokenService.setTokens(tokens.accessToken, tokens.refreshToken);
        }),
        map((tokens) => tokens.accessToken),
        finalize(() => {
          if (this.refreshForToken === refreshToken) {
            this.refreshInFlight = undefined;
            this.refreshForToken = undefined;
          }
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    return this.refreshInFlight;
  }
}
