# Documentación SafePass

## Objetivo
SafePass es una aplicación web prototipo orientada a la evaluación cognitiva de trabajadores antes de ingresar a faena. El sistema permite distinguir dos tipos de usuarios con flujos distintos: trabajador y supervisor.

## Estructura del proyecto

- src/App.tsx: orquestación principal de la interfaz
- src/main.tsx: entrada de la aplicación
- src/components/: componentes de la interfaz
- src/lib/data.ts: modelo de datos y lógica de evaluación

## Flujos principales

### 1. Login general
El usuario ingresa a una pantalla única de acceso. Según el rol autenticado, la aplicación dirige al usuario hacia una rama distinta:

- Trabajador
- Supervisor

### 2. Rama trabajador
El trabajador accede a:

- WorkerDashboard
- CognitiveTest
- TestResults

La evaluación consta de pruebas cognitivas y finaliza con un resultado global asociado a su estado.

### 3. Rama supervisor
El supervisor accede a:

- SupervisorDashboard
- ManageModal

Desde este flujo se revisan métricas, alertas y decisiones operativas del turno.

## Componentes relevantes

- WorkerLogin: acceso principal del usuario
- WorkerShell: contenedor visual de la app
- WorkerDashboard: panel del trabajador
- CognitiveTest: batería de pruebas cognitivas
- TestResults: resultado final del test
- SupervisorDashboard: dashboard de supervisión
- ManageModal: gestión de decisiones por caso
- StatusBadge: estado visual de aptitud
- lib/data.ts: datos, estado y cálculos del sistema

## Diagrama de arquitectura

Se recomienda mantener en esta carpeta los diagramas del sistema, incluidos:

- arquitectura general
- flujo de roles
- mapa del producto

## Estado del proyecto
Este repositorio corresponde a una primera entrega prototipada del frontend, con foco en la experiencia de usuario y validación del flujo principal del producto.
