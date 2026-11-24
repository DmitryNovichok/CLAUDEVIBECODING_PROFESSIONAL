# C++ playground runtime

The browser toolchain and its assets come from the npm distribution `@live-codes/clang-wasm@0.3.0`. The upstream archive has SHA-512 integrity `sha512-huXYRvmE1hwZfykw71W9/5N0Yz0yFhOPreg5cZaWGp29IY+v4w04vXUpXPPJxUftnNF41DzPG4LgoWGFeSxV9g==`. The playground uses the C++ frontend, LLD, libc++ and the in-memory filesystem. The upstream license and third-party notices are included alongside the distribution.

The two numbered pieces in `bin/` concatenate to the original `clang.wasm.gz`. Their boundary is 8 MiB. The worker assembles them when Clang first requests the compiler. The other three files in `bin/` are the original compressed assets. The npm package records their SHA-256 hashes, including the hash of the original compressed Clang binary, in `src/asset-receipts.js`.

[Upstream distribution](https://www.npmjs.com/package/@live-codes/clang-wasm/v/0.3.0)
