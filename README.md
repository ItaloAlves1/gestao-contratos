# 📄 Sistema de Gestão de Contratos

Sistema para anexar contratos, ler com IA (OpenAI) e acompanhar vencimentos no dashboard com aviso de qual contrato está vencendo e qual unidade (UPA ou Hospital).

## 📁 Estrutura

```
CONTRATOS/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── supabase-config.js
│   ├── ia-config.js
│   └── app.js
└── README.md
```

## 🔐 1. Configure o Supabase

No painel do Supabase (https://app.supabase.com):

### A) SQL Editor — recriar tabelas

Cole e rode este script (apaga tudo e cria do zero):

```sql
DROP TABLE IF EXISTS public.contratos CASCADE;
DROP TABLE IF EXISTS public.unidades CASCADE;

CREATE TABLE public.unidades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('UPA', 'Hospital')),
    cidade TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.contratos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome_arquivo TEXT NOT NULL,
    caminho_arquivo TEXT NOT NULL,
    cnpj TEXT,
    nome_empresa TEXT,
    data_assinatura DATE,
    valor_mensal NUMERIC(12,2),
    valor_anual NUMERIC(12,2),
    nome_representante_legal TEXT,
    telefone_contato TEXT,
    tipo_servico TEXT[],
    unidade_id UUID REFERENCES public.unidades(id),
    tipo_unidade TEXT CHECK (tipo_unidade IN ('UPA', 'Hospital')),
    projeto TEXT,
    data_vencimento DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.unidades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contratos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir tudo em unidades" ON public.unidades FOR ALL USING (true);
CREATE POLICY "Permitir tudo em contratos" ON public.contratos FOR ALL USING (true);

CREATE OR REPLACE VIEW public.contratos_vencendo AS
SELECT
    c.id,
    c.nome_arquivo,
    c.cnpj,
    c.nome_empresa,
    c.data_vencimento,
    c.valor_mensal,
    c.valor_anual,
    u.nome AS nome_unidade,
    u.tipo AS tipo_unidade,
    c.projeto,
    c.telefone_contato,
    c.nome_representante_legal,
    (c.data_vencimento - CURRENT_DATE) AS dias_para_vencer
FROM public.contratos c
LEFT JOIN public.unidades u ON c.unidade_id = u.id
WHERE c.data_vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
ORDER BY c.data_vencimento ASC;
```

### B) Storage — criar bucket

1. Vá em **Storage** → **New Bucket**
2. Nome: `contratos`
3. Marque como **Público** (para conseguir abrir os links dos contratos)
4. Salve

## 🤖 2. Configure a IA (OpenAI)

Escolhi o **GPT-4o-mini** porque é barato, rápido e lê muito bem PDFs e imagens de contrato.

1. Acesse https://platform.openai.com
2. Crie uma chave de API em **API Keys**
3. No arquivo `js/ia-config.js`, substitua:
   ```js
   export const OPENAI_API_KEY = 'SUA_CHAVE_DA_OPENAI_AQUI';
   ```

## 🗄️ 3. Configure o Supabase no frontend

No arquivo `js/supabase-config.js`, substitua:

```js
export const SUPABASE_URL = 'SEU_URL_DO_SUPABASE_AQUI';
export const SUPABASE_ANON_KEY = 'SUA_ANON_KEY_DO_SUPABASE_AQUI';
```

Você encontra essas chaves em: **Supabase → Settings → API**

## ▶️ 4. Como usar

1. Abra o arquivo `index.html` no seu navegador (duplo clique).
2. Clique em "Anexar ou arraste o contrato aqui" e selecione um PDF ou imagem.
3. Clique em **Anexar e Processar com IA**.
4. A IA lerá o contrato, extrairá os dados e salvará no Supabase.
5. No dashboard, você verá os contratos vencendo nos próximos 30 dias, com:
   - Nome da empresa
   - Data de vencimento
   - Quantos dias faltam
   - Unidade (UPA ou Hospital)
   - Tipo (UPA/Hospital)
   - Projeto
   - Valor mensal
   - Botão para abrir o contrato

## ⚠️ Segurança

- **Não envie** as chaves do Supabase nem da OpenAI para ninguém.
- Não suba o arquivo `js/supabase-config.js` e `js/ia-config.js` com chaves reais para repositórios públicos.
- Para uso em produção, recomendo mover a chamada da IA para uma Função Edge do Supabase (backend), para não expor a chave da OpenAI no navegador.

## 🛠️ Campos capturados pelo sistema

| Campo | Descrição |
|-------|-----------|
| nome_arquivo | Nome do arquivo anexado |
| caminho_arquivo | Link do arquivo no Supabase Storage |
| cnpj | CNPJ da empresa |
| nome_empresa | Razão social |
| data_assinatura | Data em que o contrato foi assinado |
| valor_mensal | Valor mensal do contrato |
| valor_anual | Valor anual do contrato |
| nome_representante_legal | Responsável legal |
| telefone_contato | Telefone de contato |
| tipo_servico | Lista de serviços (ex: Limpeza, Segurança) |
| tipo_unidade | UPA ou Hospital |
| projeto | Nome do projeto/obra |
| data_vencimento | Data de vencimento do contrato |
