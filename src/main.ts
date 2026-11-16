import TaoUI from '@1337exp/taoui';
import { createApp } from 'vue';

import '@1337exp/taoui/styles.css';
import 'prosemirror-view/style/prosemirror.css';
import '@1337exp/taoeditor/content.css';
import '@1337exp/taoeditor/editor.css';
import '@1337exp/taoeditor/taoui.css'; // the bridge: the editor follows the TaoUI theme / мост: редактор следует теме TaoUI
import '@/assets/font/roboto.css';
import '@/styles.css';

import App from '@/App.vue';
import { init } from '@/app/state';
import { initLocale } from '@/i18n';
import { registerAppIcons } from '@/icons';

// the theme the person chose last time, before the first paint / тема, выбранная в прошлый раз, до первой отрисовки
const mode = localStorage.getItem('axis.mode');
if (mode === 'light' || mode === 'dark') document.documentElement.dataset.taoMode = mode;
new MutationObserver(() => localStorage.setItem('axis.mode', document.documentElement.dataset.taoMode ?? 'dark')).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-tao-mode'],
});

registerAppIcons();
initLocale();
init();

createApp(App).use(TaoUI).mount('#app');
