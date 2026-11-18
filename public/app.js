// Pequenos reforcos de interface (sem dependencias).
(function () {
  'use strict';

  // Confirma acoes destrutivas.
  // Só dispara quando o clique vem de um botao, link ou submit — se o elemento
  // com data-confirm for um <form>, clicar num campo de texto nao deve abrir nada.
  document.addEventListener('click', function (ev) {
    var controle = ev.target.closest('button, a, input[type="submit"]');
    if (!controle) return;
    var alvo = controle.closest('[data-confirm]');
    if (!alvo) return;
    if (!window.confirm(alvo.getAttribute('data-confirm'))) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  });

  // Selecionar fornecedor de uma linha atualiza o custo unitario
  document.addEventListener('change', function (ev) {
    var sel = ev.target.closest('select[data-offers]');
    if (!sel) return;
    var row = sel.closest('tr');
    var costInput = row ? row.querySelector('input[name$="_cost"]') : null;
    if (!costInput) return;
    var opt = sel.options[sel.selectedIndex];
    var cost = opt ? opt.getAttribute('data-cost') : null;
    if (cost !== null && cost !== '') {
      costInput.value = cost;
      var btn = row.querySelector('[data-save-row]');
      if (btn) btn.removeAttribute('disabled');
    }
  });

  // Salvar automaticamente ao alterar quantidade de uma linha
  document.addEventListener('change', function (ev) {
    var input = ev.target.closest('input[data-autosave]');
    if (!input) return;
    var row = input.closest('tr');
    var btn = row ? row.querySelector('[data-save-row]') : null;
    if (btn) btn.removeAttribute('disabled');
  });

  // Busca de produtos: filtra a tabela local enquanto digita
  var busca = document.querySelector('[data-filter-table]');
  if (busca) {
    busca.addEventListener('input', function () {
      var term = busca.value.toLowerCase().trim();
      document.querySelectorAll('[data-filter-row]').forEach(function (tr) {
        tr.style.display = !term || tr.textContent.toLowerCase().indexOf(term) >= 0 ? '' : 'none';
      });
    });
  }

  // Mascara simples de moeda nos campos monetarios
  document.querySelectorAll('input[data-money]').forEach(function (input) {
    input.addEventListener('blur', function () {
      var raw = input.value.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
      var n = parseFloat(raw);
      if (!isNaN(n)) {
        input.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    });
  });

  // ---------------------------------------------------------------- busca ao vivo
  // Enquanto digita, pede o pedaco da lista ao servidor e troca o conteudo.
  // O formulario continua funcionando: sem JS, ou apertando Enter, a pagina recarrega.
  document.querySelectorAll('[data-busca-viva]').forEach(function (input) {
    var url = input.getAttribute('data-busca-viva');
    var seletor = input.getAttribute('data-busca-alvo');
    var alvo = seletor ? document.querySelector(seletor) : null;
    if (!url || !alvo) return;

    var parametro = input.getAttribute('data-busca-param') || 'q';
    var extra = input.getAttribute('data-busca-extra'); // outro campo do form (ex.: fornecedor)
    var minimo = parseInt(input.getAttribute('data-busca-min') || '3', 10);
    var espera = parseInt(input.getAttribute('data-busca-espera') || '250', 10);

    var timer = null;
    var sequencia = 0;

    function montarUrl(termo) {
      var partes = [parametro + '=' + encodeURIComponent(termo)];
      if (extra) {
        var campo = input.form ? input.form.elements[extra] : null;
        if (campo && campo.value) partes.push(extra + '=' + encodeURIComponent(campo.value));
      }
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + partes.join('&');
    }

    function buscar() {
      var termo = input.value.trim();

      if (termo.length < minimo) {
        alvo.innerHTML = termo.length
          ? '<p class="small muted" style="margin:10px 0 0">Continue digitando…</p>'
          : '';
        return;
      }

      var meu = ++sequencia;
      alvo.classList.add('buscando');

      fetch(montarUrl(termo), {
        headers: { 'X-Requested-With': 'fetch' },
        credentials: 'same-origin',
      })
        .then(function (r) { return r.ok ? r.text() : null; })
        .then(function (html) {
          if (meu !== sequencia) return; // resposta antiga: descarta
          alvo.classList.remove('buscando');
          if (html !== null) alvo.innerHTML = html;
        })
        .catch(function () {
          if (meu !== sequencia) return;
          alvo.classList.remove('buscando');
        });
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(buscar, espera);
    });

    // Ao trocar o fornecedor, refaz a busca com o filtro novo
    if (extra && input.form) {
      var campoExtra = input.form.elements[extra];
      if (campoExtra) {
        campoExtra.addEventListener('change', function () {
          if (input.value.trim().length >= minimo) buscar();
        });
      }
    }
  });
})();
