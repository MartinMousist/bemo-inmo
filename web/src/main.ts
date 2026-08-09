import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
// Capa producto (el acento y el matiz) primero, capa familia (la forma de los
// componentes) después: familia usa los tokens, así que tiene que verlos ya
// definidos. Ver DESIGN.md §0.
import './styles/tokens.css';
import './styles/familia.css';
// La tipografía del documento. Va global y no `scoped` porque el mismo `.documento`
// lo pintan tres pantallas —el editor de plantillas, el del documento y la hoja
// imprimible— y porque el contenido entra por `v-html`: un estilo `scoped` no
// alcanza a los nodos que Vue no compiló.
import './styles/documento.css';

import { revelar } from './directivas/revelar';

createApp(App)
  .use(createPinia())
  .use(router)
  .directive('revelar', revelar)
  .mount('#app');
