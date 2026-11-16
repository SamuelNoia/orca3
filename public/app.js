// Pequenos reforcos de interface (sem dependencias).
(function () {
  'use strict';

  // Confirma acoes destrutivas
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-confirm]');
    if (!el) return;
    if (!window.confirm(el.getAttribute('data-confirm'))) {
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
})();
