-- 0003: geometrias do catálogo (RF-CEN-04), em SQL escrito à mão (ADR-001, ADR-015).
-- As colunas foram criadas na 0002 (tipos geometry com SRID 4326, ordem longitude e latitude).

-- Área é sempre um polígono válido; dispositivo, um ponto.
ALTER TABLE areas
  ADD CONSTRAINT areas_geometry_polygon CHECK (GeometryType(geometry) = 'POLYGON'),
  ADD CONSTRAINT areas_geometry_valid CHECK (ST_IsValid(geometry));
ALTER TABLE sites ADD CONSTRAINT sites_geometry_valid CHECK (geometry IS NULL OR ST_IsValid(geometry));

CREATE INDEX sites_geometry_gist ON sites USING GIST (geometry);
CREATE INDEX areas_geometry_gist ON areas USING GIST (geometry);
CREATE INDEX devices_location_gist ON devices USING GIST (location);
