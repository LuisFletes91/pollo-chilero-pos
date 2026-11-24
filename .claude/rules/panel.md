---
description: Convenciones del panel de socios (auth MFA, consultas, roles)
paths:
  - "src/panel/**"
---

# Panel de socios

- Acceso: sesión Supabase `aal2` + `panel_whoami`; sin eso solo se ve el login o el enrolamiento TOTP.
- Lecturas con `useQuery` sobre `panel_summary` / `panel_list`, `refetchInterval: 60000`. Sin realtime.
- Escrituras con `useMutation` a una RPC; tras éxito, `invalidateQueries` de la lista afectada.
- Socio = solo lectura: los botones de supervisor no se renderizan (y la RPC igual lo rechaza).
- Formularios validados con los esquemas zod de `src/panel/forms.ts` antes de llamar a la RPC.
- El cierre del día no muestra el efectivo esperado antes de que se envíe el conteo.
- Móvil primero: una columna bajo 640 px, tablas con desplazamiento horizontal propio.
