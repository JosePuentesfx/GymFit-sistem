# NovaFit Desktop

Aplicación local de escritorio para control de miembros, pagos y acceso.

## Ejecutar

1. Instala Node.js LTS.
2. En esta carpeta ejecuta `npm install` y después `npm start`.
3. Primer acceso del dueño: usuario `admin`, contraseña `admin123`. Cámbiala antes de utilizarla en producción.

Los datos se guardan de forma local en `novafit-data.json` dentro de la carpeta de datos de la aplicación de Electron.

## Lector de huellas y torniquete

Esta base nunca almacena una imagen ni plantilla de la huella. El lector debe registrar y entregar un identificador opaco (`biometricId`) para cada socio. Cuando el SDK del proveedor detecte una huella, debe llamar a la operación equivalente a `verifyAccess(biometricId)`: si la respuesta es `allowed: true`, el integrador del SDK envía el comando de apertura al torniquete. Es necesario adaptar esa última conexión al SDK, puerto serial o API del fabricante específico.
