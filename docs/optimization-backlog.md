# Optimization Backlog (Post-Launch)

> Saved: 2026-04-22 | Priority: After production deployment & stability

| # | Task | Details |
|---|------|---------|
| 1 | Remove axios dependency entirely | Only axiosSetup.ts and a few non-page files still import it. Delete the package. |
| 2 | Route-based code splitting | Bundle is 3.5MB — React.lazy() for pages would cut initial load dramatically |
| 3 | Skeleton loading UI | Replace spinners with content-shaped skeletons for perceived speed |
| 4 | Prefetch on hover | queryClient.prefetchQuery when hovering patient rows, nav links |
| 5 | Remove authHeader utility | 67 files still import utils/auth — can be deleted now since apiClient.ts handles auth |
