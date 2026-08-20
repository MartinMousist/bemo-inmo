import { Injectable } from '@nestjs/common';
import { EmailAdaptador } from './email.adaptador';
import { MetaAdaptador } from './meta.adaptador';
import { TelegramAdaptador } from './telegram.adaptador';
import { TwilioAdaptador } from './twilio.adaptador';
import type { Adaptador } from './tipos';

/**
 * De `proveedor` al adaptador que lo maneja.
 *
 * Es el único lugar donde hay un mapa por proveedor. Todo lo demás —ingesta,
 * bot, envío, pantalla— trabaja contra la interfaz, así que agregar un
 * proveedor nuevo es sumar una clase y una línea acá.
 */
@Injectable()
export class RegistroAdaptadores {
  private readonly mapa: Map<string, Adaptador>;

  constructor(
    telegram: TelegramAdaptador,
    twilio: TwilioAdaptador,
    meta: MetaAdaptador,
    email: EmailAdaptador,
  ) {
    this.mapa = new Map([
      [telegram.proveedor, telegram as Adaptador],
      [twilio.proveedor, twilio as Adaptador],
      [meta.proveedor, meta as Adaptador],
      [email.proveedor, email as Adaptador],
    ]);
  }

  /** `null` para un proveedor que no conocemos, en vez de reventar. */
  de(proveedor: string): Adaptador | null {
    return this.mapa.get(proveedor) ?? null;
  }

  /** Los pares (canal, proveedor) que el sistema sabe manejar. */
  catalogo(): Array<{ proveedor: string; canales: string[] }> {
    return [...this.mapa.values()].map((a) => ({
      proveedor: a.proveedor,
      canales: [...a.canales],
    }));
  }
}
