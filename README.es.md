# vp-online-mcp

[![CI](https://github.com/ibsorn/vp-online-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ibsorn/vp-online-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

[English](README.md) · **Español**

Servidor [MCP](https://modelcontextprotocol.io) que permite a un agente de IA (Claude Code, Claude
Desktop, Cursor, VS Code o cualquier cliente MCP) dibujar diagramas **nativos y editables** en
[Visual Paradigm Online](https://online.visual-paradigm.com): clases, casos de uso, actividad,
secuencia, estados, componentes, despliegue, paquetes, ER, DFD, BPMN, diagramas de flujo,
organigramas, mapas mentales y cualquier otra forma de la librería de VP. **Un diagrama entero se
crea con una sola llamada.**

Lo que crea es lo mismo que obtendrías dibujando a mano en VP: clases reales con atributos y
operaciones, asociaciones con multiplicidades y roles, tablas ER con columnas PK/FK, mensajes de
secuencia ordenados, carriles BPMN. Todo vive en el modelo de VP, se puede editar desde VP y se
guarda en tu nube de VP.

![Diagrama de clases creado con una sola llamada a vp_build](docs/images/class.png)

> Proyecto no oficial, sin relación con Visual Paradigm ni respaldado por ella. Maneja el editor
> web de VP Online en un navegador con **tu propia cuenta**; úsalo respetando las condiciones de
> uso de VP.

---

## Índice
1. [Inicio rápido](#inicio-rápido)
2. [Cómo trabaja el agente](#cómo-trabaja-el-agente)
3. [Herramientas](#herramientas)
4. [Convenciones de `vp_build`](#convenciones-de-vp_build)
5. [Tipos de diagrama y ejemplos](#tipos-de-diagrama-y-ejemplos)
6. [Diseño: cómo ahorra tokens](#diseño-cómo-ahorra-tokens)
7. [Arquitectura](#arquitectura)
8. [Configuración](#configuración)
9. [Solución de problemas](#solución-de-problemas)
10. [Limitaciones conocidas](#limitaciones-conocidas)
11. [Desarrollo y pruebas](#desarrollo-y-pruebas)

---

## Inicio rápido

**Requisitos:** Node.js 20 o superior, Google Chrome o Microsoft Edge, y una cuenta de
[Visual Paradigm Online](https://online.visual-paradigm.com) (necesaria para guardar).

### 1. Añade el servidor a tu cliente MCP

**Claude Code**

```bash
claude mcp add vp-online -s user -- npx -y github:ibsorn/vp-online-mcp
```

En Windows, envuelve `npx` con `cmd /c`:

```bash
claude mcp add vp-online -s user -- cmd /c npx -y github:ibsorn/vp-online-mcp
```

**Claude Desktop** (`claude_desktop_config.json`), **Cursor** (`~/.cursor/mcp.json`) y la mayoría
de clientes:

```json
{
  "mcpServers": {
    "vp-online": {
      "command": "npx",
      "args": ["-y", "github:ibsorn/vp-online-mcp"]
    }
  }
}
```

En Windows usa `"command": "cmd"` y `"args": ["/c", "npx", "-y", "github:ibsorn/vp-online-mcp"]`.

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "vp-online": { "type": "stdio", "command": "npx", "args": ["-y", "github:ibsorn/vp-online-mcp"] }
  }
}
```

**Desde un clon** (para desarrollo): `git clone`, `npm install` y apunta el cliente a
`node /ruta/a/vp-online-mcp/server.js`.

### 2. Inicia sesión una vez

La primera llamada abre una **ventana de Chrome propia**, con un perfil separado de tu navegador
habitual. Inicia sesión en Visual Paradigm Online **una vez** en esa ventana; la sesión se guarda en
`~/.vp-online-mcp/chrome-profile`.

### 3. Pide diagramas

> *"Crea en VP el diagrama de clases de un sistema de biblioteca: User, Member, Librarian,
> BookCopy y Loan con sus atributos, herencia y asociaciones con multiplicidades. Después guárdalo
> como 'Modelo biblioteca'."*

Sin sesión iniciada también se pueden construir diagramas, pero no guardarlos: `vp_open` avisa con
`NOT SIGNED IN`.

## Cómo trabaja el agente

```
vp_open {type}  →  vp_build {elements, connectors}  →  vp_inspect  →  vp_save {name}
                     (diagrama entero, 1 llamada)    (verificar)      (nube de VP)
```

- Para cambios posteriores: `vp_edit` con varias operaciones en una llamada.
- Para ver el resultado: `vp_screenshot {path}` guarda un PNG sin gastar tokens de imagen. Sin
  `path` devuelve la imagen.
- Las convenciones llegan al modelo **una sola vez**, en las `instructions` del servidor; las
  descripciones de las herramientas son de una línea.

## Herramientas

| Herramienta | Qué hace | Anotaciones MCP |
|---|---|---|
| `vp_open {type?, url?}` | Abre un diagrama nuevo (`type`) o uno existente (`url`). Sin argumentos describe el actual. Devuelve los ids de la paleta. | no destructiva |
| `vp_shapes {query?, limit?}` | Sin `query`: la paleta del diagrama. Con `query`: busca en **toda** la librería de VP, y los resultados se pueden usar en `vp_build`. | solo lectura |
| `vp_build {elements?, connectors?, layout?, columns?, clear?}` | Crea muchos elementos y conectores de una vez. Si un elemento falla, sigue con los demás y lo informa. | destructiva (por `clear`) |
| `vp_edit {ops}` | Cambios por lotes (ver la tabla siguiente). | destructiva |
| `vp_inspect {ref?, filter?, detail?, limit?}` | Listado compacto del diagrama. | solo lectura |
| `vp_save {name?}` | Guarda en la nube de VP. Si el diagrama ya está guardado y `name` es distinto, guarda una copia. | no destructiva, idempotente |
| `vp_screenshot {path?, ref?, scale?}` | Imagen recortada al contenido, o a un solo elemento con `ref`. | solo lectura |
| `vp_eval {code}` | Vía de escape: ejecuta JS en el editor con el objeto `api`. | destructiva |

### Operaciones de `vp_edit`

| `op` | Campos | Efecto |
|---|---|---|
| `label` | `ref`, `text` | Renombra un elemento o conector. |
| `move` | `ref`, `x`, `y` | Mueve el elemento. |
| `resize` | `ref`, `w`, `h` | Cambia el tamaño. |
| `rows` | `ref`, `rows`, `rowAction?` | Añade filas (atributos, operaciones, columnas…). |
| `removeRows` | `ref`, `match?` (regex) | Quita filas; sin `match`, todas. |
| `ends` | `ref`, `mult?`, `roles?` | Multiplicidades y roles `[from, to]` de un conector. |
| `style` | `ref`, `style` | Estilo mxGraph, por ejemplo `fillColor=#FFF2CC;`. |
| `delete` | `ref` | Borra el elemento y sus conectores. |
| `add` | campos de un elemento | Añade un elemento. |
| `connect` | campos de un conector | Añade un conector. |
| `layout` | `kind` | Organiza el diagrama: `grid`, `hierarchical`, `horizontal`, `organic` o `tree`. Las jerárquicas trazan los conectores; las demás borran sus puntos de paso. |
| `fit` | `ref` | Ajusta el tamaño al texto. |

### Formato de `vp_inspect`

```
"Untitled" ClassDiagram | 8 elements, 7 connectors | unsaved
#1 Class "User" @60,40 252x91 [-id : String; -fullName : String; -failedLogins : int; +login(id : String, pwd : String) : boolean]
#7 Interface "Authenticable" @460,40 252x58 [+login(id : String, pwd : String) : boolean]
#10 Generalization Member -> User
#12 Association Member{0..1} -> BookCopy{0..1} "holds"
#15 Association BookCopy{1,role=copy} -> Loan{0..*,role=loans} "lent in"
```

- `#id` es un id corto que cualquier herramienta acepta como `ref`. Las claves y las etiquetas
  también sirven.
- El tipo que aparece es el mismo id de la paleta que usa `vp_build`.
- Los conectores se muestran **en la misma dirección** en que se crearon.
- `detail:"brief"` quita las coordenadas y resume las filas como `(9 rows)`.
- `filter` y `ref` acotan la salida.
- `limit` limita el número de líneas (150 por defecto) y, si recorta, dice cómo acotar.

## Convenciones de `vp_build`

**Elemento**: `{shape, label?, key?, x?, y?, w?, h?, parent?, rows?, rowAction?, style?}`

- `shape` es el id de la paleta, por ejemplo `Class`, `Actor`, `UseCase`, `System`, `Entity`,
  `DeviceNode`, `Action` o `Lifeline`. Ver `vp_open` o `vp_shapes`.
- `key` es el nombre con el que lo citan `from`, `to` y `parent`. Si falta, se cita por la
  etiqueta.
- **Posición**: sin `x` ni `y`, el elemento se coloca automáticamente en una cuadrícula sin
  solapes. Con `parent` se coloca **dentro** del contenedor, que crece para que todo quepa. Las
  coordenadas son píxeles y las de un hijo son relativas a su padre.
- **`rows`**: el servidor decide en qué compartimento va cada fila:
  - En una clase o interfaz, una fila con `(` es una operación; el resto son atributos.
  - En ER, una fila es `"nombre tipo"` y puede llevar el prefijo `PK `, `FK ` o `PK,FK `.
  - En otras formas se usa `rowAction` (`addTrigger`, `addProcedure`, `addClause`…); si falta, el
    error lista las opciones.
  - Una fila también puede ser `{text, action?, set?}`. `set` escribe atributos XML del modelo,
    por ejemplo `{"nullable":"false"}`.
- **Calles de actividad**: en `VerticalSwimlane` y `HorizontalSwimlane`, `rows` son los nombres de
  las particiones. Se renombran las dos de la plantilla, se eliminan las que sobren y cada nombre
  extra añade una (una columna en `VerticalSwimlane`). VP solo añade particiones verticales a una
  `HorizontalSwimlane`, lo que forma una cuadrícula: para N carriles usa `VerticalSwimlane`.
- **Formas adjuntas** (`Port`, `InputPin`, `OutputPin`, `ActivityParameterNode`, `Lane`) necesitan
  `parent`: los puertos y pines van en el borde del padre y los carriles se apilan dentro del pool.
- `label: ""` borra el nombre por defecto, por ejemplo el texto "DecisionNode".

**Conector**: `{shape, from, to, label?, mult?, roles?, y?, points?, key?, style?}`

- **Dirección**: la punta de flecha queda siempre en **`to`**.
  - Generalization: `from` es la subclase y `to` la superclase.
  - Realization: `from` es la clase que implementa.
  - Include y Extend: `from` es el caso de uso base.
- En Aggregation y Composition el rombo queda en **`from`** (el todo).
- `mult` y `roles` se dan como `[from, to]`, por ejemplo `"mult": ["1", "0..*"]`.
- **Secuencia**: los mensajes se apilan de arriba abajo en el orden dado; `y` fija la altura de uno.
  `SelfMessage` dibuja un bucle con la etiqueta al lado, y las líneas de vida se alargan solas.
- `points` son puntos de paso `[[x,y],…]`.
- Si dos conectores unen los mismos elementos, se separan automáticamente para que no queden
  superpuestos (no se aplica a los mensajes de secuencia ni a los conectores con `points`).
- Los textos de los conectores quedan legibles: el nombre va junto a la línea (encima si es
  horizontal), y la multiplicidad y el rol de cada extremo van a lados opuestos de la línea. Los
  textos que muevas a mano no se tocan.

**Errores**: son accionables. Por ejemplo:
- `unknown shape "Clas". Did you mean: Class?`
- `"Solo" is ambiguous (#3, #4): use one of these #ids`
- `Port must be attached to a parent element (set parent)`

Ejemplo mínimo (un diagrama de clases en una llamada):

```json
{
  "elements": [
    {"shape": "Class", "label": "BookCopy", "rows": ["-barcode : String", "-price : float"]},
    {"shape": "Class", "label": "Loan", "rows": ["-loanId : int", "+close() : void"]}
  ],
  "connectors": [
    {"shape": "Association", "from": "BookCopy", "to": "Loan", "label": "lent in", "mult": ["1", "0..*"]}
  ]
}
```

## Tipos de diagrama y ejemplos

Cada tipo tiene un ejemplo completo y **probado** en [`examples/`](examples); la suite e2e ejecuta
exactamente esos ficheros.

| `type` | Formas clave | Conectores clave | Ejemplo |
|---|---|---|---|
| `ClassDiagram` | Class, Interface, Enumeration, Package, Note | Generalization, Realization, Association, Aggregation, Composition, Dependency, Usage | [class.json](examples/class.json) |
| `UseCaseDiagram` | Actor, UseCase, System | Association, Include, Extend, Generalization | [usecase.json](examples/usecase.json) |
| `ActivityDiagram` | InitialNode, Action, DecisionNode, MergeNode, ForkNode, JoinNode, ActivityFinalNode, InputPin/OutputPin, VerticalSwimlane | ControlFlow, ObjectFlow | [activity.json](examples/activity.json) |
| `SequenceDiagram` | Actor, Lifeline, BoundaryLifeline, ControlLifeline, EntityLifeline, LoopCombinedFragment | Message, ReplyMessage, SelfMessage, CreateMessage | [sequence.json](examples/sequence.json) |
| `StateMachineDiagram` | InitialPseudoState, State, Choice, FinalState | Transition | [state.json](examples/state.json) |
| `ComponentDiagram` | Component, Interface, Port | Usage, Realization, Dependency | [component.json](examples/component.json) |
| `DeploymentDiagram` | Node, DeviceNode, ExecutionEnvironmentNode, Artifact, Component | Link, Dependency, Deployment | [deployment.json](examples/deployment.json) |
| `PackageDiagram` | Package, Subsystem | Dependency, Import, Access, Merge | [package.json](examples/package.json) |
| `ERDiagram` | Entity, View, Triggers, StoredProcedures | OnetoOneRelationship, OnetoManyRelationship, ManytoManyRelationship | [er.json](examples/er.json) |
| `DataFlowDiagram` | Process, ExternalEntity, DataStore | DataFlow, BidirectionalDataFlow | [dfd.json](examples/dfd.json) |
| `BusinessProcessDiagram` | HorizontalPool, Lane, StartEvent, Task, UserTask, gateways, EndEvent | SequenceFlow, MessageFlow | [bpmn.json](examples/bpmn.json) |
| `Flowchart` | Start, Process, Decision, Data, Terminator… | FlowLine | [flowchart.json](examples/flowchart.json) |
| `OrganizationChart` | Unit | Line | [orgchart.json](examples/orgchart.json) |
| `MindMapDiagram` | Node | Branch | [mindmap.json](examples/mindmap.json) |

Cualquier otro tipo de VP también se abre con su `type`, y `vp_shapes {query}` encuentra cualquier
forma de su librería.

| Secuencia | BPMN |
|---|---|
| ![Diagrama de secuencia](docs/images/sequence.png) | ![Diagrama BPMN](docs/images/bpmn.png) |

## Diseño: cómo ahorra tokens

El diseño sigue las prácticas publicadas por Anthropic y por la especificación MCP, y lo que hacen
los servidores MCP más usados ([fuentes](#fuentes)).

| Práctica | Cómo se aplica |
|---|---|
| **Pocas herramientas, con propósito distinto y que cubren flujos completos** | 8 herramientas en lugar de una por acción. `vp_build` crea un diagrama entero en una llamada. `vp_open` sustituye a tres herramientas (nuevo, abrir y estado) y `vp_shapes` a dos (paleta y búsqueda). |
| **Contexto común una sola vez** | Las convenciones van en las `instructions` del servidor; las descripciones de las herramientas son de una línea. |
| **Esquemas pequeños y planos** | Un único campo `rows` en lugar de `attributes`, `operations`, `columns` y `members`. `mult` y `roles` como `[from, to]`. Sin `$schema` ni metadatos por defecto en el listado; las anotaciones solo se envían cuando no son el valor por defecto. |
| **Respuestas compactas y con significado** | Ids cortos (`#12`) y conectores con nombres legibles. `vp_build` devuelve una línea por grupo y nunca repite el diagrama. |
| **Formato de respuesta elegible** | `vp_inspect` con `detail:"brief"`, `filter`, `ref` y `limit`; si recorta, dice cómo acotar. |
| **Errores accionables** | Sugerencias "Did you mean", lista de `#id` en caso de ambigüedad, campos que faltan y la acción de fila válida. |
| **Imágenes solo si hacen falta** | `vp_screenshot {path}` guarda el PNG y solo devuelve la ruta. |
| **Vía de escape tipo "code mode"** | `vp_eval` filtra o agrega dentro de la página y devuelve solo el resultado. |
| **Robustez** | Llamadas de una en una con límites de tiempo, reintento si VP recarga la página y detección de la sesión caducada. |

Coste fijo medido con `npm run measure`: **8 herramientas + instrucciones ≈ 1.600 tokens**.

Rendimiento medido:

| Caso | Tiempo |
|---|---|
| Diagrama de clases (8 clases, 7 relaciones) | ~0,6 s |
| 40 clases, 320 filas y 45 relaciones (60 multiplicidades) | ~5–12 s según la carga de la máquina |

Cómo: cada fase de la construcción va en **una transacción** del modelo, el renderizado y el panel
de formato se pausan mientras se trabaja, y las filas se escriben sin pasar por el editor de texto
en línea.

## Arquitectura

```
server.js        MCP por stdio: 8 herramientas, instrucciones, cola, timeouts, errores
lib/browser.js   Chrome dedicado (perfil propio, CDP en el puerto 9333) que sobrevive a reinicios del MCP
lib/vp.js        Ciclo de vida de la pestaña, inyección, workspace, guardar, capturas
lib/page-api.js  API inyectada en el editor de VP (mxGraph); hace todo el trabajo
examples/        Un diagrama de ejemplo por tipo (también son los datos de las pruebas e2e)
test/            e2e.js (suite de aceptación), smoke.js (sin navegador, CI), measure.js, client.js
scripts/eval.js  Utilidad de depuración: evalúa JS en la pestaña del editor
```

**Por qué el resultado es nativo:** `page-api.js` usa los caminos del propio VP en lugar de dibujar
celdas sueltas:

| Para… | Usa… |
|---|---|
| Crear formas | El `mxDragSource.drop()` de cada ítem de la paleta (como arrastrarlo). |
| Crear conectores y formas adjuntas | La plantilla de la paleta (`getCell()`) más `connectCell`. |
| Crear filas | Los métodos "Add X" del menú contextual de VP. |
| Cambiar nombres | `graph.labelChanged`. |

**Resistente a actualizaciones de VP:** el código de VP está minificado, así que el servidor no
escribe a mano ningún nombre interno:
- Las instancias de `EditorUi` y `Graph` se capturan al vuelo.
- Los metadatos de la paleta se reconocen por su forma.
- Los métodos "Add X" se descubren leyendo el código del menú (`mxResources.get("addAttribute")…`).
- El tipo de cada celda se lee de `origin.paletteItemUiId`, que VP guarda en el modelo.

## Configuración

| Variable | Por defecto | Uso |
|---|---|---|
| `CHROME_PATH` | autodetectado | Ruta de Chrome o Edge. |
| `VP_MCP_PORT` | `9333` | Puerto CDP del Chrome dedicado. |
| `VP_MCP_PROFILE` | `~/.vp-online-mcp/chrome-profile` | Perfil donde se guarda la sesión de VP. |
| `VP_WORKSPACE` | autodetectado | Id del workspace de VP (el `<ws>` de `online.visual-paradigm.com/w/<ws>/`). Se recuerda en `~/.vp-online-mcp/state.json`. |
| `VP_MCP_HEADLESS=1` | no | Chrome sin ventana. Solo sirve si la sesión ya está iniciada. |

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `NOT SIGNED IN`, o `vp_save` dice que no hay sesión | La sesión de VP caducó. Inicia sesión otra vez en la ventana de Chrome del MCP y repite `vp_open`. |
| `No diagram is open` | Llama a `vp_open {type}` o a `vp_open {url}`. |
| `unknown shape "X"` | Usa uno de los ids que sugiere el error, o busca con `vp_shapes {query}`. |
| Se cerró la ventana de Chrome | La siguiente llamada la vuelve a abrir con la misma sesión. |
| `Chrome not found` | Instala Chrome o Edge, o define `CHROME_PATH`. |
| `Could not attach to the VP editor` | Recarga la pestaña. Si persiste, VP ha cambiado su estructura interna: [abre una incidencia](https://github.com/ibsorn/vp-online-mcp/issues). |
| Un `vp_build` muy grande da timeout (5 min) | Divídelo en varias llamadas. `vp_inspect` muestra lo que ya se aplicó. |

## Limitaciones conocidas

- **Guardar requiere sesión.** VP caduca las sesiones tras unas horas; vuelve a iniciar sesión
  cuando se te avise.
- **Secuencia:** los mensajes no crean barras de activación. Sigue siendo UML válido; si las
  quieres, añádelas en VP.
- **Organización automática:** usa los algoritmos de mxGraph y no esquiva obstáculos en las líneas.
  Para diagramas cuidados da `x`/`y` explícitos.
- **Búsqueda de formas:** los ids de los resultados (`Decision10`…) los genera VP y pueden cambiar.
  `vp_build` también acepta el título, por ejemplo `"Decision"`.
- **No oficial:** depende del editor web de VP Online. Una actualización de VP puede romper algo
  hasta que este proyecto se adapte; la suite e2e existe para detectarlo rápido.

## Desarrollo y pruebas

```bash
npm run check        # prueba rápida sin navegador: herramientas, esquemas, ejemplos, metadatos
npm test             # suite e2e completa contra VP Online, sin guardar (~2–5 min)
npm run test:save    # también guarda, vuelve a guardar, guarda copia y reabre (crea 2 diagramas en tu nube)
npm test -- class er # solo esas suites
npm run measure      # coste en tokens de las definiciones
```

La suite **e2e** (`test/e2e.js`) usa el servidor real por stdio contra VP Online y comprueba
resultados concretos: los 14 tipos de diagrama, cada operación de `vp_edit`, los modos de
`vp_inspect` y las capturas, las cinco organizaciones automáticas sin solapes, los errores y sus
mensajes, la búsqueda de formas, las llamadas en paralelo, guardar/copiar/reabrir/editar tras
recargar, y una prueba de carga (40 clases, 320 filas y 45 relaciones). Último resultado:
**220/220** con guardado. Deja capturas de cada diagrama en `test/out/` para revisarlas a ojo.

Consulta [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) y [CHANGELOG.md](CHANGELOG.md).

## Fuentes

- Anthropic, [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):
  consolidar herramientas, respuestas concisas o detalladas, ids con significado, errores
  accionables, paginación y truncado.
- Anthropic, [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp):
  revelado progresivo y filtrado de datos dentro del entorno de ejecución.
- [Especificación MCP: Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools):
  anotaciones y resultados con `isError`.
- bump.sh, [4 rules to build an efficient MCP server](https://bump.sh/blog/4-rules-to-build-an-efficient-mcp-server).
- Cloudflare, [Code Mode](https://blog.cloudflare.com/code-mode/): una superficie pequeña de
  búsqueda/ejecución en lugar de miles de herramientas.
- Playwright MCP, [snapshots](https://playwright.dev/mcp/snapshots): texto estructurado en lugar
  de capturas de pantalla.

## Licencia

[MIT](LICENSE). Visual Paradigm es una marca registrada de su propietario.
