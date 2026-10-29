// ============================================
// Configurações (definidas no index.html)
// ============================================
const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_ANON_KEY = CONFIG.SUPABASE_ANON_KEY;
const STORAGE_BUCKET = CONFIG.STORAGE_BUCKET;
const OPENAI_API_KEY = CONFIG.OPENAI_API_KEY;
const OPENAI_MODEL = CONFIG.OPENAI_MODEL;

// Inicializa Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Elementos do DOM
const inputArquivo = document.getElementById('inputArquivo');
const btnProcessar = document.getElementById('btnProcessar');
const areaDrop = document.getElementById('areaDrop');
const listaContratos = document.getElementById('listaContratos');
const btnAtualizar = document.getElementById('btnAtualizar');
const toast = document.getElementById('toast');

// Estado
let arquivoSelecionado = null;

// ============================================
// 1. UPLOAD DE ARQUIVO
// ============================================

inputArquivo.addEventListener('change', (e) => {
    arquivoSelecionado = e.target.files[0];
    if (arquivoSelecionado) {
        btnProcessar.disabled = false;
        btnProcessar.textContent = `Processar: ${arquivoSelecionado.name}`;
    }
});

// Drag & drop
areaDrop.addEventListener('dragover', (e) => {
    e.preventDefault();
    areaDrop.classList.add('dragover');
});
areaDrop.addEventListener('dragleave', () => {
    areaDrop.classList.remove('dragover');
});
areaDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    areaDrop.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        arquivoSelecionado = files[0];
        btnProcessar.disabled = false;
        btnProcessar.textContent = `Processar: ${arquivoSelecionado.name}`;
    }
});

// ============================================
// 2. PROCESSAR CONTRATO (Upload + IA + Supabase)
// ============================================

btnProcessar.addEventListener('click', async () => {
    if (!arquivoSelecionado) return;

    btnProcessar.disabled = true;
    btnProcessar.textContent = 'Processando...';

    try {
        const tipo = arquivoSelecionado.type || '';
        const ehPDF = tipo === 'application/pdf' || arquivoSelecionado.name.toLowerCase().endsWith('.pdf');
        const ehImagem = tipo.startsWith('image/');

        if (!ehPDF && !ehImagem) {
            throw new Error('Tipo de arquivo não suportado. Use PDF, PNG, JPG ou JPEG.');
        }

        // --- Passo A: Upload para Supabase Storage ---
        mostrarToast('Enviando contrato para o Supabase...', 'info');

        const caminhoArquivo = `contratos/${Date.now()}_${arquivoSelecionado.name}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(caminhoArquivo, arquivoSelecionado);

        if (uploadError) throw uploadError;

        // Obter URL pública do arquivo
        const { data: urlData } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(caminhoArquivo);

        const urlPublica = urlData.publicUrl;

        // --- Passo B: Extrair texto do arquivo (PDF ou Imagem) ---
        mostrarToast('Extraindo texto do contrato...', 'info');

        let textoExtraido = '';

        if (ehPDF) {
            textoExtraido = await extrairTextoPDF(arquivoSelecionado);
        } else if (ehImagem) {
            textoExtraido = await converterParaBase64(arquivoSelecionado);
        }

        // --- Passo C: Chamar IA para extrair dados estruturados ---
        mostrarToast('Lendo dados com IA...', 'info');
        const dadosIA = await chamarIaContrato(textoExtraido, ehPDF, arquivoSelecionado.type);

        // --- Passo D: Salvar no banco de dados ---
        const contratoParaSalvar = {
            nome_arquivo: arquivoSelecionado.name,
            caminho_arquivo: urlPublica,
            cnpj: dadosIA.cnpj || null,
            nome_empresa: dadosIA.nome_empresa || null,
            data_assinatura: dadosIA.data_assinatura || null,
            valor_mensal: dadosIA.valor_mensal || null,
            valor_anual: dadosIA.valor_anual || null,
            nome_representante_legal: dadosIA.nome_representante_legal || null,
            telefone_contato: dadosIA.telefone_contato || null,
            tipo_servico: dadosIA.tipo_servico || [],
            tipo_unidade: dadosIA.tipo_unidade || null,
            projeto: dadosIA.projeto || null,
            data_vencimento: dadosIA.data_vencimento || null,
        };

        const { error: dbError } = await supabase
            .from('contratos')
            .insert([contratoParaSalvar]);

        if (dbError) throw dbError;

        mostrarToast('Contrato processado e salvo com sucesso!', 'success');
        inputArquivo.value = '';
        btnProcessar.disabled = true;
        btnProcessar.textContent = 'Anexar e Processar';
        arquivoSelecionado = null;

        // Atualizar dashboard
        carregarContratosVencendo();

    } catch (erro) {
        console.error(erro);
        mostrarToast(`Erro: ${erro.message}`, 'danger');
        btnProcessar.disabled = false;
        btnProcessar.textContent = 'Anexar e Processar';
    }
});

// ============================================
// 3. EXTRAIR TEXTO DE PDF (pdf.js)
// ============================================

async function extrairTextoPDF(arquivo) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.onload = async () => {
            try {
                const arrayBuffer = leitor.result;
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let textoCompleto = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const pagina = await pdf.getPage(i);
                    const conteudo = await pagina.getTextContent();
                    const textoPagina = conteudo.items
                        .map(item => item.str)
                        .join(' ');
                    textoCompleto += `\n--- Página ${i} ---\n${textoPagina}\n`;
                }

                resolve(textoCompleto);
            } catch (erro) {
                reject(erro);
            }
        };
        leitor.onerror = reject;
        leitor.readAsArrayBuffer(arquivo);
    });
}

// ============================================
// 4. CHAMADA À IA (OpenAI)
// ============================================

async function chamarIaContrato(textoOuBase64, ehPDF, tipoArquivo) {
    let prompt;
    let messages;

    if (ehPDF) {
        // PDF: enviamos o texto extraído para a IA analisar
        prompt = `
Você é um assistente especializado em leitura de contratos de prestação de serviços para unidades de saúde (UPA e Hospital).

Abaixo está o TEXTO EXTRAÍDO de um contrato em PDF. Analise e extraia EXATAMENTE estes campos em JSON:

- cnpj (apenas números, ex: 12345678000190)
- nome_empresa
- data_assinatura (formato AAAA-MM-DD)
- valor_mensal (número, apenas o valor, ex: 5000)
- valor_anual (número)
- nome_representante_legal
- telefone_contato
- tipo_servico (array de strings, ex: ["Limpeza", "Segurança"])
- tipo_unidade ("UPA" ou "Hospital")
- projeto (nome do projeto/obra referente ao contrato)
- data_vencimento (formato AAAA-MM-DD)

TEXTO DO CONTRATO:
${textoOuBase64}

Se algum campo não estiver claro ou não existir, deixe null ou array vazio [].
Responda APENAS com o JSON válido, sem texto adicional, sem markdown.
`;

        messages = [
            { role: 'user', content: prompt }
        ];
    } else {
        // Imagem: enviamos a imagem para a OpenAI Vision
        prompt = `
Você é um assistente especializado em leitura de contratos de prestação de serviços para unidades de saúde (UPA e Hospital).

Analise a imagem do contrato e extraia EXATAMENTE estes campos em JSON:

- cnpj (apenas números, ex: 12345678000190)
- nome_empresa
- data_assinatura (formato AAAA-MM-DD)
- valor_mensal (número, apenas o valor, ex: 5000)
- valor_anual (número)
- nome_representante_legal
- telefone_contato
- tipo_servico (array de strings, ex: ["Limpeza", "Segurança"])
- tipo_unidade ("UPA" ou "Hospital")
- projeto (nome do projeto/obra referente ao contrato)
- data_vencimento (formato AAAA-MM-DD)

Se algum campo não estiver claro ou não existir, deixe null ou array vazio [].
Responda APENAS com o JSON válido, sem texto adicional, sem markdown.
`;

        messages = [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${tipoArquivo};base64,${textoOuBase64}`
                        }
                    }
                ]
            }
        ];
    }

    const resposta = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: OPENAI_MODEL,
            messages: messages,
            max_tokens: 1000,
            temperature: 0.1
        })
    });

    if (!resposta.ok) {
        const erroTexto = await resposta.text();
        throw new Error(`Erro da IA: ${resposta.status} ${erroTexto}`);
    }

    const dados = await resposta.json();
    const textoIA = dados.choices[0].message.content;

    // Tenta extrair JSON da resposta
    try {
        return JSON.parse(textoIA);
    } catch (e) {
        const match = textoIA.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('Não foi possível extrair dados do contrato via IA.');
    }
}

// ============================================
// 5. DASHBOARD - CONTRATOS VENCENDO
// ============================================

async function carregarContratosVencendo() {
    try {
        const { data, error } = await supabase
            .from('contratos_vencendo')
            .select('*')
            .order('data_vencimento', { ascending: true });

        if (error) throw error;

        renderizarDashboard(data || []);
    } catch (erro) {
        console.error(erro);
        listaContratos.innerHTML = `
            <div class="alerta-erro">
                Erro ao carregar contratos: ${erro.message}
            </div>
        `;
    }
}

function renderizarDashboard(contratos) {
    if (!contratos || contratos.length === 0) {
        listaContratos.innerHTML = `
            <div class="vazio">
                <p>Nenhum contrato vencendo nos próximos 30 dias.</p>
            </div>
        `;
        return;
    }

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    let html = `
        <table class="tabela-contratos">
            <thead>
                <tr>
                    <th>Empresa</th>
                    <th>Vencimento</th>
                    <th>Dias</th>
                    <th>Unidade</th>
                    <th>Tipo</th>
                    <th>Projeto</th>
                    <th>Valor Mensal</th>
                    <th>Ação</th>
                </tr>
            </thead>
            <tbody>
    `;

    contratos.forEach(c => {
        const dataVenc = new Date(c.data_vencimento);
        const diffDias = Math.ceil((dataVenc - hoje) / (1000 * 60 * 60 * 24));

        let classeDias = 'dias-ok';
        let textoDias = `${diffDias} dias`;

        if (diffDias <= 7) {
            classeDias = 'dias-perigo';
            textoDias = `URGENTE: ${diffDias} dias`;
        } else if (diffDias <= 30) {
            classeDias = 'dias-atencao';
            textoDias = `${diffDias} dias`;
        }

        html += `
            <tr>
                <td>${c.nome_empresa || '-'}</td>
                <td>${formatarData(c.data_vencimento)}</td>
                <td class="${classeDias}">${textoDias}</td>
                <td>${c.nome_unidade || 'Não informada'}</td>
                <td>${c.tipo_unidade || '-'}</td>
                <td>${c.projeto || '-'}</td>
                <td>R$ ${Number(c.valor_mensal || 0).toFixed(2)}</td>
                <td>
                    <button class="btn-ver" onclick="abrirContrato('${c.caminho_arquivo}')" title="Ver contrato">
                        📄 Ver
                    </button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    listaContratos.innerHTML = html;
}

// Expor função para uso no HTML
window.abrirContrato = (url) => {
    window.open(url, '_blank');
};

// ============================================
// 6. UTILITÁRIOS
// ============================================

function converterParaBase64(arquivo) {
    return new Promise((resolve, reject) => {
        const leitor = new FileReader();
        leitor.readAsDataURL(arquivo);
        leitor.onload = () => {
            const resultado = leitor.result.split(',')[1];
            resolve(resultado);
        };
        leitor.onerror = reject;
    });
}

function formatarData(dataISO) {
    if (!dataISO) return '-';
    const d = new Date(dataISO + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
}

function mostrarToast(mensagem, tipo = 'info') {
    const corpo = document.getElementById('toastCorpo');
    const icone = document.getElementById('toastIcone');

    corpo.textContent = mensagem;

    if (tipo === 'success') {
        icone.textContent = '✅';
        toast.className = 'toast toast-sucesso';
    } else if (tipo === 'danger') {
        icone.textContent = '❌';
        toast.className = 'toast toast-erro';
    } else if (tipo === 'warning') {
        icone.textContent = '⚠️';
        toast.className = 'toast toast-aviso';
    } else {
        icone.textContent = 'ℹ️';
        toast.className = 'toast toast-info';
    }

    toast.classList.add('mostrar');

    setTimeout(() => {
        toast.classList.remove('mostrar');
    }, 4000);
}

// Inicializar dashboard ao carregar
document.addEventListener('DOMContentLoaded', () => {
    carregarContratosVencendo();
    if (btnAtualizar) {
        btnAtualizar.addEventListener('click', carregarContratosVencendo);
    }
});
