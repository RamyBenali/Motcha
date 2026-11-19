// Applique le thème avant le premier affichage, pour éviter un flash de couleurs.
(function () {
  try {
    var space = new URLSearchParams(location.search).get('profil');
    var prefs = JSON.parse(localStorage.getItem((space ? 'motcha:' + space.slice(0, 12) + ':' : 'motcha:') + 'prefs') || '{}');
    var root = document.documentElement;
    if (prefs.theme === 'day') root.dataset.theme = 'day';
    if (prefs.colorblind) root.dataset.cb = '1';
  } catch (e) {
    /* préférences illisibles : thème par défaut */
  }
})();
