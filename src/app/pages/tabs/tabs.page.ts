import { RouterLink } from '@angular/router';
/**
 * TaxOffix - Página de Tabs
 * ================================
 * Contenedor principal con la barra de navegación inferior.
 * Incluye 4 tabs:
 * - Dashboard: Estadísticas y resumen
 * - Tracking: Iniciar/detener tracking GPS
 * - Historial: Ver recorridos anteriores
 * - Perfil: Configuración del usuario
 */

import { Component, ChangeDetectionStrategy } from '@angular/core';
import {
  IonTabs,
  IonTabBar,
  IonTabButton,
  IonIcon,
  IonLabel,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  homeOutline,
  home,
  navigateOutline,
  navigate,
  timeOutline,
  time,
  personOutline,
  person,
  settingsOutline,
  settings,
  settingsSharp,
} from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [RouterLink, IonTabs, IonTabBar, IonTabButton, IonIcon],
  templateUrl: './tabs.page.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './tabs.page.scss',
})
export class TabsPage {
  constructor() {
    // Registrar iconos
    addIcons({
      homeOutline,
      home,
      navigateOutline,
      navigate,
      timeOutline,
      time,
      personOutline,
      person,
      settingsOutline,
      settings,
      settingsSharp,
    });
  }
}
