# ÉlectroTale

🌍 [English](README.md) · [Français](README.fr.md) · **Español** · [Italiano](README.it.md) · [Deutsch](README.de.md) · [Português](README.pt.md)

*El grimorio electrónico.* Un juego de aventura de texto para Windows en el que una IA narra tu historia, dibuja las escenas y las lee en voz alta. Todo funciona en tu PC: sin cuenta, sin suscripción, sin censura.

> **Beta.** ÉlectroTale ha sido ideado y dirigido por Béryl, que no sabe programar. Todo el código lo ha escrito Claude, la IA de Anthropic, a partir de sus ideas y comentarios. Puede haber errores: abre una *issue* para avisarnos.

**Solo para mayores de 18 años.** Los modelos de IA propuestos no tienen censura. Cualquier contenido sexual con menores está bloqueado, tanto en el texto como en las imágenes.

## Qué incluye

- Toda la aplicación en 6 idiomas: español, inglés, francés, italiano, alemán y portugués. Elige el tuyo en la pantalla de inicio (🌍); la historia lo sigue.
- La Forja del mundo: elige un género y una idea, y el Narrador crea la descripción, los pueblos, los lugares, los personajes y el comienzo de la historia. Todo sigue siendo editable en el Taller.
- Un lanzador que analiza tu PC (procesador, memoria, tarjeta gráfica) y descarga los modelos adecuados.
- El destino en un d20, combates y pruebas, cartas de tarot, un diario de misiones, 31 hazañas y una recompensa diaria.
- Imágenes generadas en local (stable-diffusion.cpp) y una voz narradora (Kokoro con sherpa-onnx).
- Una carpeta `Documents\ElectroTale` para modificar mundos, personajes, reglas y modelos.

## Instalar

Descarga el instalador en las *Releases*. Si Windows muestra «Windows protegió su PC», haz clic en **Más información** y luego en **Ejecutar de todas formas**.

Requisitos: Windows 10 u 11 de 64 bits, 16 GB de RAM recomendados, una tarjeta gráfica compatible con Vulkan (un chip Intel o AMD reciente también sirve, más despacio).

## Traducir ÉlectroTale

¿Falta tu idioma o una frase suena rara? Cada idioma es un solo archivo en [`app/langues/`](app/langues). [TRANSLATING.md](TRANSLATING.md) explica cómo corregir una traducción o añadir un idioma, sin programar.

## Privacidad

ÉlectroTale solo se conecta a internet cuando le pides descargar un modelo: lo obtiene de Hugging Face, sujeto a [su política de privacidad](https://huggingface.co/privacy). Tus historias se quedan en tu PC. El instalador aún no está firmado ([detalles](README.md#code-signing-policy)).

## Licencias

El código de ÉlectroTale está bajo licencia **GPL v3 o posterior** (ver `LICENSE`). Los modelos de IA no están incluidos: el lanzador los descarga de Hugging Face y cada uno conserva su propia licencia (lista completa en la pestaña *Licencias y créditos* del juego). **Built with Llama.** Llama 3.1 y 3.2 están bajo la Llama Community License, Copyright © Meta Platforms, Inc.
