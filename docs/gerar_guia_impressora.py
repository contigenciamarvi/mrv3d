from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether, PageBreak
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

F = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("S", F + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("SB", F + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("M", F + "DejaVuSansMono.ttf"))
from reportlab.lib.fonts import addMapping
addMapping("S", 0, 0, "S"); addMapping("S", 1, 0, "SB"); addMapping("S", 0, 1, "S"); addMapping("S", 1, 1, "SB")

AZUL = colors.HexColor("#1d4ed8"); ESC = colors.HexColor("#0f172a"); CINZA = colors.HexColor("#475569")
CLARO = colors.HexColor("#f1f5f9"); BORDA = colors.HexColor("#cbd5e1"); AMB = colors.HexColor("#fef3c7"); AMBB = colors.HexColor("#d97706")

st = {
 "titulo": ParagraphStyle("t", fontName="SB", fontSize=20, leading=25, textColor=ESC, spaceAfter=4),
 "sub": ParagraphStyle("s", fontName="S", fontSize=10.5, leading=15, textColor=CINZA, spaceAfter=10),
 "h1": ParagraphStyle("h1", fontName="SB", fontSize=13.5, leading=18, textColor=AZUL, spaceBefore=12, spaceAfter=6),
 "h2": ParagraphStyle("h2", fontName="SB", fontSize=11, leading=15, textColor=ESC, spaceBefore=6, spaceAfter=3),
 "p": ParagraphStyle("p", fontName="S", fontSize=10, leading=14.5, textColor=ESC, spaceAfter=5),
 "li": ParagraphStyle("li", fontName="S", fontSize=10, leading=14.5, textColor=ESC, leftIndent=12, bulletIndent=2, spaceAfter=2),
 "code": ParagraphStyle("c", fontName="M", fontSize=8.6, leading=12, textColor=ESC),
 "nota": ParagraphStyle("n", fontName="S", fontSize=9.5, leading=13.5, textColor=ESC),
 "rod": ParagraphStyle("r", fontName="S", fontSize=8, textColor=CINZA),
}
def P(t, s="p"): return Paragraph(t, st[s])
def L(itens): return [Paragraph(i, st["li"], bulletText="•") for i in itens]
def code(*linhas):
    t = Table([[Paragraph("<br/>".join(l.replace("&", "&amp;").replace("<", "&lt;") for l in linhas), st["code"])]], colWidths=[170*mm])
    t.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), CLARO), ("BOX", (0,0), (-1,-1), 0.5, BORDA), ("LEFTPADDING", (0,0), (-1,-1), 8), ("RIGHTPADDING", (0,0), (-1,-1), 8), ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6)]))
    return t
def caixa(texto, fundo=AMB, borda=AMBB):
    t = Table([[Paragraph(texto, st["nota"])]], colWidths=[170*mm])
    t.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), fundo), ("LINEBEFORE", (0,0), (0,-1), 3, borda), ("LEFTPADDING", (0,0), (-1,-1), 9), ("RIGHTPADDING", (0,0), (-1,-1), 8), ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6)]))
    return t
def passo(n, titulo, corpo):
    num = Table([[Paragraph(f"<font color='white'><b>{n}</b></font>", ParagraphStyle("x", fontName="SB", fontSize=11, alignment=1, leading=14))]], colWidths=[8*mm], rowHeights=[8*mm])
    num.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), AZUL), ("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("ROUNDEDCORNERS", [4,4,4,4])]))
    cab = Table([[num, Paragraph(titulo, st["h2"])]], colWidths=[11*mm, 159*mm])
    cab.setStyle(TableStyle([("VALIGN", (0,0), (-1,-1), "MIDDLE"), ("LEFTPADDING", (0,0), (-1,-1), 0)]))
    return KeepTogether([Spacer(1, 6), cab, Spacer(1, 3)] + corpo)

s = []
s += [P("Como conectar a impressora 3D pela rede", "titulo"),
      P("MRV3D Solutions · Monitoramento de impressoras · Agente local versão 0.1.0", "sub")]
s += [P("O que é", "h1"),
      P("Um programa pequeno, o <b>agente</b>, roda num computador da sua oficina que está na mesma rede (Wi-Fi ou cabo) da impressora. "
        "Ele lê o estado da impressora (status, progresso, temperaturas, tempo restante) e envia ao painel em <b>Impressoras › Monitoramento</b>."),
      *L(["<b>Somente leitura:</b> não pausa, não cancela e não envia impressões.",
          "Não abre portas no roteador: o agente só faz conexões de saída (HTTPS) para o painel.",
          "Os dados da impressora (código de acesso, chave de API) ficam só nesse computador. A senha da sua conta Bambu Lab nunca é pedida.",
          "Se a internet cair, ele guarda os eventos e envia quando voltar."])]
s += [P("Do que você precisa", "h1"),
      *L(["Um computador que fique ligado enquanto a impressora trabalha: Windows, Linux ou Raspberry Pi, <b>na mesma rede</b> da impressora.",
          "<b>Python 3.9 ou mais novo.</b> No Windows, baixe em <b>python.org</b> e, na instalação, marque <b>“Add Python to PATH”</b>.",
          "Acesso ao painel como dono ou administrador da empresa (para gerar o código de pareamento)."])]

s += [P("Passo a passo — Bambu Lab (Windows)", "h1")]
s += [passo(1, "Anote os dados da impressora", [
    *L(["Na tela da impressora: <b>Configurações › WLAN</b>: anote o <b>IP</b> (ex.: 192.168.0.50) e o <b>código de acesso</b> (8 caracteres).",
        "Em <b>Configurações › Dispositivo</b>: anote o <b>número de série</b>."])])]
s += [passo(2, "Gere o código de pareamento no painel", [
    *L(["Entre em <b>mrv3dsolutions.tech</b> › <b>Integrações › Bambu Lab › Configurações</b> › <b>Conectar agente</b>.",
        "Dê um nome ao computador (ex.: “PC da oficina”) e copie o código no formato <b>XXXXX-XXXXX</b>. Ele vale <b>15 minutos</b> e só pode ser usado uma vez."])])]
s += [passo(3, "Baixe o agente", [
    *L(["Crie a pasta <b>C:\\mrv3d</b>.",
        "Baixe <b>https://mrv3dsolutions.tech/agente/mrv3d_agente.py</b> e salve nessa pasta.",
        "Abra o <b>Prompt de Comando</b> (tecla Windows, digite cmd) e entre na pasta:"]),
    code("cd C:\\mrv3d", "pip install paho-mqtt"),
    Spacer(1, 4),
    P("Opcional, para conferir o download: <font name='M' size='8.6'>certutil -hashfile mrv3d_agente.py SHA256</font> e compare com "
      "<b>https://mrv3dsolutions.tech/agente/mrv3d_agente.py.sha256</b>.")])]
s += [passo(4, "Pareie o agente com a sua empresa", [
    code("python mrv3d_agente.py parear SEU-CODIGO --site https://mrv3dsolutions.tech"),
    Spacer(1, 4), P("Deve aparecer “Agente pareado com …” e o nome da sua empresa.")])]
s += [passo(5, "Adicione a impressora", [
    P("Se não souber o IP ou o número de série, com a impressora ligada rode:"),
    code("python mrv3d_agente.py descobrir"),
    Spacer(1, 4), P("Depois adicione (troque pelos seus dados):"),
    code('python mrv3d_agente.py adicionar bambu --nome "X1" --ip 192.168.0.50 --serial NUMERO_DE_SERIE --codigo CODIGO_DE_ACESSO'),
    Spacer(1, 4), P("O agente registra o certificado da impressora nesse momento e depois recusa outro, para ninguém na rede se passar por ela.")])]
s += [passo(6, "Teste a conexão", [
    code("python mrv3d_agente.py testar"),
    Spacer(1, 4), P("O esperado: <b>conexão online</b>, estado e temperaturas do bico e da mesa. Se der erro, veja “Problemas comuns”.")])]
s += [passo(7, "Ligue a impressora no painel", [
    *L(["Em <b>Impressoras › Monitoramento</b>, clique na impressora › <b>Conectar</b>.",
        "Tipo: <b>Bambu Lab (rede local)</b>. Identificador: o <b>número de série</b>.",
        "O painel mostra o comando pronto para copiar, com o nome da impressora."])])]
s += [passo(8, "Deixe o agente rodando", [
    code("python mrv3d_agente.py rodar"),
    Spacer(1, 4),
    P("Enquanto essa janela estiver aberta, o painel recebe os dados (atualiza a cada 10 a 15 segundos). Para iniciar sozinho quando o Windows liga:"),
    *L(["Abra o <b>Agendador de Tarefas</b> › <b>Criar tarefa</b>.",
        "Disparador: <b>Ao fazer logon</b>.",
        "Ação: Iniciar um programa › <b>pythonw.exe</b>, argumentos <b>C:\\mrv3d\\mrv3d_agente.py rodar</b>, iniciar em <b>C:\\mrv3d</b>."])])]

s += [P("Linux ou Raspberry Pi", "h1"),
      P("Os comandos são os mesmos, usando <b>python3</b> no lugar de <b>python</b>. Para iniciar sozinho (troque SEU_USUARIO):"),
      code("sudo tee /etc/systemd/system/mrv3d-agente.service >/dev/null <<'X'", "[Unit]", "Description=MRV3D agente de impressoras", "After=network-online.target",
           "[Service]", "User=SEU_USUARIO", "ExecStart=/usr/bin/python3 /home/SEU_USUARIO/mrv3d_agente.py rodar", "Restart=always", "RestartSec=10",
           "[Install]", "WantedBy=multi-user.target", "X", "sudo systemctl enable --now mrv3d-agente")]

s += [P("Klipper (Moonraker) e OctoPrint", "h1"),
      P("Mesmo processo; só muda o passo 5:"),
      code('python mrv3d_agente.py adicionar moonraker --nome "Voron" --ip 192.168.0.60',
           'python mrv3d_agente.py adicionar octoprint --nome "Ender" --ip 192.168.0.70 --api-key SUA_CHAVE'),
      Spacer(1, 4),
      P("A chave do OctoPrint fica em <b>Configurações › Application Keys</b>. No painel, escolha o tipo Klipper/Moonraker ou OctoPrint e use o identificador mostrado pelo agente.")]

s += [P("Problemas comuns", "h1")]
tab = [[P("<b>O que aparece</b>"), P("<b>O que fazer</b>")],
 [P("“erro de autenticação”"), P("Confira o código de acesso (ele muda quando a impressora é reiniciada de fábrica ou quando você gera outro). Em firmwares da Bambu de 2025 em diante, pode ser preciso ativar o <b>modo LAN</b> e, em alguns modelos, o <b>Modo Desenvolvedor</b>.")],
 [P("“offline”"), P("Impressora desligada, IP mudou ou o computador está noutra rede. Rode <b>descobrir</b> de novo. Dica: fixe o IP da impressora no roteador.")],
 [P("“Endereço recusado”"), P("O agente só aceita endereços da rede local (192.168…, 10…, 172.16–31…). Use o IP mostrado na impressora.")],
 [P("“o certificado da impressora mudou”"), P("Acontece se trocou a impressora ou o firmware mudou o certificado. Rode o comando <b>adicionar</b> de novo.")],
 [P("“Código inválido, já usado ou expirado”"), P("Gere outro código no painel: ele vale 15 minutos e é de uso único.")],
 [P("“Este agente foi revogado”"), P("O agente foi desligado no painel ou a integração foi desconectada. Gere um novo código e pareie de novo.")],
 [P("Painel mostra a impressora “sem dados recentes”"), P("O agente não está rodando ou o computador está sem internet. Os eventos ficam guardados e são enviados quando voltar.")]]
t = Table(tab, colWidths=[55*mm, 115*mm], repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), CLARO), ("GRID", (0,0), (-1,-1), 0.4, BORDA), ("VALIGN", (0,0), (-1,-1), "TOP"),
                       ("LEFTPADDING", (0,0), (-1,-1), 6), ("RIGHTPADDING", (0,0), (-1,-1), 6), ("TOPPADDING", (0,0), (-1,-1), 4), ("BOTTOMPADDING", (0,0), (-1,-1), 4)]))
s += [t, Spacer(1, 10)]
s += [caixa("<b>Importante sobre a Bambu Lab.</b> Ativar o modo LAN ou o Modo Desenvolvedor desliga recursos de nuvem e do app Bambu Handy enquanto estiver ativo. "
            "Leia o aviso da Bambu na impressora antes de ativar. Câmera e controle remoto não estão disponíveis no MRV3D.")]
s += [Spacer(1, 8), P("Para remover", "h1"),
      P("No painel, em <b>Integrações › Bambu Lab › Configurações</b>, revogue o agente. No computador, apague a pasta <b>.mrv3d-agente</b> dentro da pasta do seu usuário "
        "(no Windows: <b>C:\\Users\\SEU_USUARIO\\.mrv3d-agente</b>), que guarda o código de acesso da impressora.")]

def rodape(c, d):
    c.saveState(); c.setFont("S", 8); c.setFillColor(CINZA)
    c.drawString(20*mm, 10*mm, "MRV3D Solutions · mrv3dsolutions.tech")
    c.drawRightString(190*mm, 10*mm, f"Página {d.page}")
    c.restoreState()

doc = SimpleDocTemplate("painel/public/agente/guia-conectar-impressora.pdf", pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=18*mm,
                        title="Como conectar a impressora 3D pela rede", author="MRV3D Solutions", subject="Agente local de monitoramento")
doc.build(s, onFirstPage=rodape, onLaterPages=rodape)
print("ok")
