# Migrações SQL versionadas

O Prisma cuida só do catálogo. Hipertabelas do TimescaleDB, agregados contínuos, geometrias e índices espaciais do PostGIS e políticas de row level security ficam aqui, em SQL cru (ADR-001).

Convenção de nome: `NNNN_descricao_curta.sql`, aplicados em ordem crescente e nunca editados depois de entrar em um portão. A pasta fica vazia até a trilha T1c.
