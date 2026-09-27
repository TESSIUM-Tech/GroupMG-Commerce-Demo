# Coraza / OWASP CRS — integración pendiente

El init no habilita WAF. Coraza será un filtro WASM dentro de APISIX,
no un contenedor que inspeccione tráfico automáticamente.

Antes de habilitarlo: seleccionar versiones compatibles del runtime APISIX,
coraza-proxy-wasm y CRS; fijar el artefacto por checksum; construir la imagen;
registrar el plugin y asociarlo a las rutas. Validar primero en DetectionOnly
y luego en bloqueo, incluyendo pruebas de webhook con cuerpo intacto,
falsos positivos, tamaño de payload y exclusiones mínimas por endpoint.

No publicar este entorno como producción sin TLS, WAF validado y límites de tráfico.

Referencias:

- https://apisix.apache.org/docs/apisix/wasm/
- https://apisix.apache.org/blog/2024/02/13/apisix-owasp-coraza-core-ruleset/
