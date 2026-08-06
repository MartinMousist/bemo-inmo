import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
// Capa producto (el acento y el matiz) primero, capa familia (la forma de los
// componentes) después: familia usa los tokens, así que tiene que verlos ya
// definidos. Ver DESIGN.md §0.
import './styles/tokens.css';
import './styles/familia.css';

import { revelar } from './directivas/revelar';

createApp(App)
  .use(createPinia())
  .use(router)
  .directive('revelar', revelar)
  .mount('#app');
