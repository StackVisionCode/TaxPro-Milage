import {
  HttpErrorResponse,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';

import { environment } from '../../environments/environment';
import { CustomerSessionRefreshService } from '../services/customer-session-refresh.service';
import { CustomerTokenService } from '../services/customer-token.service';

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const tokenService = inject(CustomerTokenService);
  const refreshService = inject(CustomerSessionRefreshService);
  const router = inject(Router);

  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const isLogin = req.url.includes(environment.endpoints.login);
  const isRefresh = req.url.includes(environment.endpoints.refreshToken);
  const identity=()=>{const c=tokenService.decodeToken();return c ? `${c.tenant_id}:${c.customer_id ?? ''}:${c.sub}` : null;};
  const owner=identity();
  const token = tokenService.token;
  const request = token && !isLogin && !isRefresh
    ? addTokenToRequest(req, token)
    : req;

  return next(request).pipe(
    catchError((error: HttpErrorResponse) => {
      if(identity()!==owner) return throwError(()=>error);
      const canRefresh =
        error.status === 401 &&
        !isLogin &&
        !isRefresh &&
        !!tokenService.refreshToken;

      if (canRefresh) {
        return refreshService.refreshAccessToken().pipe(
          switchMap((accessToken) => identity()===owner
            ? next(addTokenToRequest(req, accessToken))
            : throwError(()=>new Error('La cuenta cambio durante la solicitud.'))),
          catchError((refreshError) => {
            if(identity()===owner) {
              tokenService.removeTokens();
              router.navigate(['/login']);
            }
            return throwError(() => refreshError);
          })
        );
      }

      if (error.status === 401 && !isLogin) {
        tokenService.removeTokens();
        router.navigate(['/login']);
      }

      return throwError(() => error);
    })
  );
};

function addTokenToRequest(
  request: HttpRequest<unknown>,
  token: string
): HttpRequest<unknown> {
  return request.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`,
    },
  });
}
