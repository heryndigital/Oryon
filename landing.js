document.querySelectorAll('#currencyToggle button').forEach(btn => {
  btn.addEventListener('click', () => {
    const currency = btn.dataset.currency;
    document.querySelectorAll('#currencyToggle button').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.plan-card .price').forEach(el => {
      const value = currency === 'USD' ? el.dataset.usd : el.dataset.brl;
      el.innerHTML = value + '<small>/mês</small>';
    });
  });
});
