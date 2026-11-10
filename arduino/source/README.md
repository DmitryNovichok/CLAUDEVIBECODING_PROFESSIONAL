# MicroLab

A self-contained electronics workspace inspired by Wokwi. This is an independent, incomplete implementation, not an official Wokwi product or a fully compatible clone.

## Run

Open the published Site, or download `dist/local-compiler.zip` and follow its Russian README. The local package uses Python 3 and optionally Arduino CLI, serves on 127.0.0.1:8765, and requires no cloud compilation service. No Python packages are required.

## Develop

`npm ci`, `npm run build`, `npm test`. `npm run package` produces the offline ZIP with the web application and editable sources. Static output lives in `dist/`. `src/app.js` owns the editor, diagram/net graph, persistence, and device routing. `src/runtime.js` owns AVR/UF2 firmware loaders and the limited educational Arduino API. `src/catalog.js` lists truthful support levels and examples. `local/server.py` supplies optional local C++ compilation through Arduino CLI.

## Supported

- Wiring editor, draggable components, zoom/pan, property inspector, schema edits, undo/redo, local persistence and JSON import/export.
- Arduino Uno/Nano: AVR instruction emulation via AVR8js, HEX input, GPIO, ADC, timers and UART.
- Educational subset of Arduino C++ syntax in a Web Worker; not a C++ compiler. JS numeric semantics apply.
- Digital connectivity for LED, resistors, buttons, switches and potentiometers. No physical voltage/current simulation.
- Educational API models for Servo, LiquidCrystal, DHT and tone; these protocols are not implemented for native firmware.
- Pico UF2 integration with RP2040js and B1 boot ROM, GPIO/UART/USB CDC. Experimental; arbitrary firmware compatibility is unverified.
- ESP32/Mega and other parts explicitly marked visual-only.

## Not implemented

ESP32 CPU/Wi-Fi, Mega CPU, Raspberry Pi Linux, complete I2C/SPI/one-wire peripheral models, arbitrary browser C++ compilation, exact C++ type semantics, all Wokwi libraries, debugger UI, online accounts/sharing, automatic library installation, electrical solver. Firmware is not embedded in exported JSON. Wokwi wire routes are redrawn from endpoints; rotation and unknown parts are not supported.

## Validation

Node runtime tests cover HEX checksum/range/EOF errors, real AVR SBI GPIO output, UF2 size validation, five educational examples, LCD output, loops, strings and unsupported include rejection. Browser QA covers editor rendering, Blink/Serial, wired LED, LCD output and project persistence. Full firmware ecosystem coverage is not claimed.

## Licenses

See `dist/licenses.txt` for third-party notices: AVR8js, RP2040js, Wokwi Elements, Lit, Raspberry Pi boot ROM. Dependencies are pinned by package-lock.json. No external scripts/CDN resources are needed at runtime.

The combined distribution is provided under GPL-2.0, preserving MIT/BSD notices for components. Pico ROM soft-float is used under its stated GPLv2 alternative. Corresponding upstream boot ROM sources are included in dist/pico-bootrom-source.tar.gz. The local ZIP includes editable application sources.

The real Arduino CLI compile endpoint, invalid-board and cross-origin checks were tested successfully. A compiled Blink image is available as dist/blink-uno.hex.

## Academy and redesigned interface

Dedicated home, board/component catalog, course, lesson, workshop and project pages. The grade 7 course contains 36 Arduino lessons in 9 modules, from LED and buttons to a traffic light, barrier and weather station. Each lesson awards 10 XP for theory, 20 for wiring and 70 for observed program behavior. Later lessons unlock sequentially. Checking requires an active simulation of the unchanged project; merely viewing an answer does not complete a lesson.

Progress and individual lesson drafts are stored in the current browser. Export/import on the course page transfers progress and drafts as JSON; there is no cloud account synchronization. Up to 20 free project checkpoints are retained locally. The educational checks validate selected observable behaviors, not arbitrary firmware correctness or electrical safety.

Run `npm test` for runtime and course validation, then `npm run build`.

The separate grades 10–11 course contains 36 engineering labs across the same 9 themes. Every lesson has a worked example, classroom activity, mini-project and written homework. Homework is saved locally and included in progress backups. Tests exercise all six advanced reference sketches against simulated inputs.

## Component catalog
103 catalog entries cover the 49 custom elements registered by the bundled Wokwi Elements package and additional schematic symbols. 14 entries provide simulation, 23 use educational API/signal models, one is experimental, and 65 are for schematic design. Some board-family symbols expose power only. Sensor controls set the output level directly. The logic generator supports 0.1–10 Hz; GPIO sampling is not cycle accurate. Find the inverter and breadboard example in the Examples menu.

## Classroom theme

The classroom theme follows the supplied Egeshka screenshot: white rounded cards, soft grey borders, green action buttons, blue selections and a two-column navigation rail with a 36-lesson progress map. Lesson tiles reflect the existing three-step completion state, and the course selector keeps the two age groups separate. The editor, routed wires, zoom, circuit fitting, bundled IBM Plex fonts and local launcher are retained. Both 36-lesson curricula, homework drafts, telemetry checks and all 103 catalog entries remain present. The educational interpreter retains its existing limited semantics. Errors appear in an editor panel with Russian explanations. Source lines are shown when returned by the local compiler.

`npm test` covers the 72 lesson definitions and exercises all 54 additional reference/unfinished sketches. Browser checks cover the first lesson end to end, circuit editing, catalog search, errors, and persistence. Font license is included under `dist/fonts/OFL-IBM-Plex.txt`.


## Guest classroom release

Registration is not required by the application. Courses, the simulator, local progress, project history, assignments and teacher feedback work without an account. The hosting audience is a separate setting; a private Sites preview can still require its owner's sign-in. To run on a school network without that gate, use the offline ZIP and `server.py` on the school's machine.

- Progress uses per-lesson, per-field storage keys and reads the previous `microlab.academy.v1` format without deleting it. Storage events update other tabs. Completed steps merge without erasing homework.
- Saving validates and commits the diagram editor. Circuit undo preserves subsequent code edits. The last 12 saved versions are available from the clock button. Conflicting project edits from another tab require an explicit choice; the local draft can be downloaded.
- Circuit grading accepts electrically equivalent GND pins, breadboard paths and renamed components. Blink requires two timed 500/500 ms cycles; dimmer and servo tests pair output with the input value.
- Each of the 72 lessons has an age-specific explanation, five-stage worksheet, independent extension, notes and demonstration criteria. Worksheet ticks are self-assessment and award no XP. Homework is separate from automatic practice results.
- “Работа с учителем” has local classes, assignment files, student work files (code, diagram, homework and notes), feedback and a teacher journal backup. These files are transferred manually. Names and reviews are not cryptographically authenticated. No central classroom server or online accounts are implemented.
- The mobile workspace has Task / Code / Circuit panels. Desktop keeps the split view.
- The HC-SR04 educational model supports triggered `pulseIn()` using an adjustable distance from 2 to 400 cm. The API model is not a cycle-accurate peripheral and does not support native firmware. Power checks cover the course sensors, LCD, servo and potentiometers; direct supply-to-ground connections block launch. This remains a digital educational model, not a circuit-current solver.

`npm test` now includes the HTTP smoke test and reliability regressions (storage, undo, circuit equivalence, timed checks, power and exchange files). Use `npm run package` to build the application and offline source ZIP. A full Arduino CLI compilation remains a separate environment-dependent integration test.
