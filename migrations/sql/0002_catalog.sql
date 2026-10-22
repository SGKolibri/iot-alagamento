-- 0002: catálogo (T1b, RF-CEN-01 a 03, RF-DIS-01 e 02). ADR-015.
-- As tabelas vêm do schema do Prisma; as geometrias e os índices espaciais ficam na 0003.
-- O teste test/catalog/prisma-migration.spec.ts confere que o trecho abaixo é o que o Prisma gera.

CREATE EXTENSION IF NOT EXISTS postgis;

-- Gerado pelo Prisma a partir de apps/core-api/prisma/schema.prisma:
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('NUNCA_CONECTADO', 'ONLINE', 'SEM_SINAL');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domains" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "domain_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expected_interval_s" INTEGER NOT NULL,
    "quantities" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "device_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geometry" geometry(Geometry,4326),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geometry" geometry(Geometry,4326) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "domain_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "profile_version" INTEGER NOT NULL,
    "site_id" UUID NOT NULL,
    "area_id" UUID,
    "manufacturer" TEXT,
    "firmware" TEXT,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "location" geometry(Point,4326),
    "status" "device_status" NOT NULL DEFAULT 'NUNCA_CONECTADO',
    "last_contact_at" TIMESTAMPTZ(3),
    "credential_id" TEXT NOT NULL,
    "credential_hash" TEXT NOT NULL,
    "credential_salt" TEXT NOT NULL,
    "credential_expires_at" TIMESTAMPTZ(3),
    "credential_revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "domains_tenant_id_slug_key" ON "domains"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "domains_id_tenant_id_key" ON "domains"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "device_profiles_tenant_id_domain_id_idx" ON "device_profiles"("tenant_id", "domain_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_profiles_id_tenant_id_key" ON "device_profiles"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_tenant_id_slug_key" ON "sites"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "sites_id_tenant_id_key" ON "sites"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "areas_tenant_id_site_id_slug_key" ON "areas"("tenant_id", "site_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "areas_id_tenant_id_key" ON "areas"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_credential_id_key" ON "devices"("credential_id");

-- CreateIndex
CREATE INDEX "devices_tenant_id_status_idx" ON "devices"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenant_id_slug_key" ON "devices"("tenant_id", "slug");

-- AddForeignKey
ALTER TABLE "domains" ADD CONSTRAINT "domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_profiles" ADD CONSTRAINT "device_profiles_domain_id_tenant_id_fkey" FOREIGN KEY ("domain_id", "tenant_id") REFERENCES "domains"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_domain_id_tenant_id_fkey" FOREIGN KEY ("domain_id", "tenant_id") REFERENCES "domains"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_profile_id_tenant_id_fkey" FOREIGN KEY ("profile_id", "tenant_id") REFERENCES "device_profiles"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_tenant_id_fkey" FOREIGN KEY ("site_id", "tenant_id") REFERENCES "sites"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_area_id_tenant_id_fkey" FOREIGN KEY ("area_id", "tenant_id") REFERENCES "areas"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;
