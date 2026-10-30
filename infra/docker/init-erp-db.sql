-- Script de inicialización para reutilizar la misma instancia de PostgreSQL
-- evitando contenedores duplicados en desarrollo local.
SELECT 'CREATE USER erp_demo WITH ENCRYPTED PASSWORD ''erp-local-change-me'''
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'erp_demo')\gexec

SELECT 'CREATE DATABASE erp_demo OWNER erp_demo'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'erp_demo')\gexec

GRANT ALL PRIVILEGES ON DATABASE erp_demo TO erp_demo;
