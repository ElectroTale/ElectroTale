# ÉlectroTale

🌍 [English](README.md) · [Français](README.fr.md) · [Español](README.es.md) · [Italiano](README.it.md) · [Deutsch](README.de.md) · **Português**

*O grimório eletrônico.* Um jogo de aventura em texto para Windows em que uma IA narra a sua história, desenha as cenas e as lê em voz alta. Tudo roda no seu PC: sem conta, sem assinatura, sem censura.

> **Beta.** O ÉlectroTale foi idealizado e dirigido por Béryl, que não sabe programar. Todo o código foi escrito pelo Claude, a IA da Anthropic, a partir das ideias e opiniões de Béryl. Pode haver bugs: abra uma *issue* para avisar.

**Somente para maiores de 18 anos.** Os modelos de IA oferecidos não têm censura. Qualquer conteúdo sexual envolvendo menores é bloqueado, no texto e nas imagens.

## O que tem dentro

- O aplicativo inteiro em 6 idiomas: português, inglês, francês, espanhol, italiano e alemão. Escolha o seu na tela inicial (🌍); a história acompanha.
- Um lançador que analisa o PC (processador, memória, placa de vídeo) e baixa os modelos adequados.
- O destino no d20, combates e provas, cartas de tarô, um diário de missões, 31 façanhas e uma recompensa diária.
- Imagens geradas localmente (stable-diffusion.cpp) e uma voz narradora (Kokoro via sherpa-onnx).
- Uma pasta `Documents\ElectroTale` para modificar mundos, personagens, regras e modelos.

## Instalar

Baixe o instalador em *Releases*. Se o Windows mostrar “O Windows protegeu o computador”, clique em **Mais informações** e depois em **Executar assim mesmo**.

Requisitos: Windows 10 ou 11 de 64 bits, 16 GB de RAM recomendados, uma placa de vídeo compatível com Vulkan (um chip Intel ou AMD recente também serve, mais devagar).

## Traduzir o ÉlectroTale

Falta o seu idioma ou uma frase soa estranha? Cada idioma é um único arquivo em [`app/langues/`](app/langues). O [TRANSLATING.md](TRANSLATING.md) explica como corrigir uma tradução ou adicionar um idioma, sem programar.

## Privacidade

O ÉlectroTale só se conecta à internet quando você pede para baixar um modelo: ele o busca no Hugging Face, sujeito à [sua política de privacidade](https://huggingface.co/privacy). Suas histórias ficam no seu PC. O instalador ainda não é assinado ([detalhes](README.md#code-signing-policy)).

## Licenças

O código do ÉlectroTale está sob a licença **GPL v3 ou posterior** (veja `LICENSE`). Os modelos de IA não estão incluídos: o lançador os baixa do Hugging Face, e cada um mantém sua própria licença (lista completa na aba *Licenças e créditos* do jogo). **Built with Llama.** Llama 3.1 e 3.2 estão sob a Llama Community License, Copyright © Meta Platforms, Inc.
