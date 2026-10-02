# Production assets

Coffice ships only reviewed runtime assets. Source artwork, references, prompts,
rejected candidates, proofs, and working files remain outside the product
repository.

The distributed character artwork is original to Coffice. Each promoted PNG is
an RGBA production file with fixed dimensions, stripped metadata, and a pinned
hash. The strict-overhead sheets share one six-character identity order and
registered contact anchors so animation does not shift actors across the floor.

> **Licensing:** Runtime artwork is distributed under the proprietary
> [Coffice artwork license](../ASSET-LICENSE.md).

| File                                                                            | Dimensions | SHA-256                                                            | Public provenance                                                                          |
| ------------------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `public/assets/topdown-office/coffice-overhead-agent-sheet-v2.png`              |  1254×1254 | `2ae4acf4709a5e0482b17ada174d100094f13079aa8dfd335bdebaaf35324fb6` | Original strict-overhead idle character sheet, normalized and reviewed at runtime scale.   |
| `public/assets/topdown-office/coffice-overhead-agent-work-sheet-v3.png`         |  1254×1254 | `7c8d9a2c83e3118dca3168f1f2e583776d2432661ff904d7e9dad47dfd2c6068` | Identity-matched strict-overhead seated work sheet with registered desk contact.           |
| `public/assets/topdown-office/coffice-overhead-agent-seated-rest-v4.png`        |  1254×1254 | `0188b054706b2365c23708018e3fd935d161fe744c07cdf307a7d2b8c6a6f3c5` | Identity-matched seated rest poses aligned to the production chair anchor.                 |
| `public/assets/topdown-office/coffice-overhead-agent-walk-left-contact-v4.png`  |  1254×1254 | `3aafc1275a0d3b5c448ec95eec7fbec75ee10900a863ba398c57fd9a33343eb4` | Grounded left-foot contact frame with the six production identities.                       |
| `public/assets/topdown-office/coffice-overhead-agent-walk-left-passing-v4.png`  |  1254×1254 | `ec37adfa7380d17b2a87c0d6851ab4e7471870c59861a5f81a619c2b62421850` | Grounded left-foot passing frame with registered contact and body scale.                   |
| `public/assets/topdown-office/coffice-overhead-agent-walk-right-contact-v4.png` |  1254×1254 | `0923b4ad1be99caac1f3eababde094be4f9e5eb943246384cf0bdac5dc87f760` | Lossless per-character counterpart to the left-contact frame.                              |
| `public/assets/topdown-office/coffice-overhead-agent-walk-right-passing-v4.png` |  1254×1254 | `e816ed32bce40b70046d8bb45f86d95219e0724206a6aa6b6ecbc4be15893763` | Lossless per-character counterpart to the left-passing frame.                              |
| `public/assets/topdown-office/coffice-overhead-agent-typing-alternate-v4.png`   |  1254×1254 | `0582bc4fadaa6cb0965b8b2857e220b6788541b55a9f55a84232f8674ac826ac` | Identity-matched alternate typing poses aligned to the seated work sheet.                  |
| `public/assets/topdown-office/coffice-overhead-agent-sit-mid-sheet-v4.png`      |  1254×1254 | `9b10995961c8136658134d0c5b11b02b3b4926a8ec90aea4633d7199192e68e2` | Grounded midpoint poses for the sit and stand transitions.                                 |
| `public/assets/topdown-office/coffice-overhead-agent-attention-wave-v4.png`     |  1254×1254 | `78b1745d9cd6941a6f7aa51e94fe118ee66363c91115aa5ace52ac1ff0e2a9c3` | Identity-matched attention gesture reviewed over light, dark, and transparent backgrounds. |
| `public/assets/topdown-office/coffice-overhead-agent-completion-v4.png`         |  1254×1254 | `bf7dd4a80fddb06714c255f098abbece37936c8e4676d5bc2b555a3ca0526235` | Identity-matched restrained completion gesture reviewed at original and runtime scales.    |

## Promotion requirements

New or replacement assets require redistribution-rights review, metadata
stripping, deterministic dimensions and hashes, visual review at supported
viewports, and all production checks. Development source material must not ship
with the promoted file. `npm run verify:assets` decodes every listed file and
rejects incorrect hashes or dimensions, unsafe metadata or content,
unmanifested files, missing files, and assets with no source or test consumer.
