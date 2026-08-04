import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ExchangeConnector, OrderParams, OrderResult, BalanceResult } from './interfaces/exchange-connector.interface';
import { ExchangeName } from '../exchange-connections/dto/exchange-connection.dto';

@Injectable()
export class BrvmConnector implements ExchangeConnector {
  readonly exchange = ExchangeName.BRVM;
  private readonly logger = new Logger(BrvmConnector.name);

  // BRVM n'a pas d'API publique pour l'exécution d'ordres.
  // Les ordres sont créés en statut "MANUAL" pour que l'utilisateur
  // les exécute manuellement via son broker (SGCI, Coris, BOA, etc.).
  // Le connector génère un ticket d'ordre formaté selon les conventions BRVM.

  async placeOrder(_apiKey: string, _apiSecret: string, params: OrderParams): Promise<OrderResult> {
    this.validateBrvmSymbol(params.symbol);

    const orderId = `BRVM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ticket = this.generateOrderTicket(orderId, params);

    this.logger.log(`BRVM manual order ticket generated: ${orderId} symbol=${params.symbol} side=${params.side}`);

    return {
      orderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      status: 'MANUAL',
      executedQty: String(params.quantity),
      avgPrice: params.price ? String(params.price) : '0',
      transactTime: Date.now(),
      exchange: ExchangeName.BRVM,
      raw: {
        ticket,
        brokerInstructions: 'Transmettez ce ticket à votre broker BRVM pour exécution manuelle.',
        estimatedSettlement: 'T+3 (règlement BRVM)',
      },
    };
  }

  async getAccountBalance(_apiKey: string, _apiSecret: string): Promise<BalanceResult[]> {
    // BRVM: pas de API balance. L'utilisateur consulte son compte broker.
    return [{
      asset: 'XOF',
      free: '0',
      locked: '0',
    }];
  }

  async validateCredentials(_apiKey: string, _apiSecret: string): Promise<boolean> {
    // BRVM: pas de credentials API. On valide juste que le compte est configuré.
    return true;
  }

  private validateBrvmSymbol(symbol: string) {
    const brvmSymbols = [
      'ONTBF', 'SGBF', 'BOABF', 'ETIT', 'SIVC', 'PALC', 'SOGC', 'SNTS',
      'CIEC', 'NSIC', 'ORGT', 'BICC', 'CBIBF', 'ABJC', 'STAC',
    ];
    if (!brvmSymbols.includes(symbol)) {
      throw new BadRequestException(
        `BRVM: symbole "${symbol}" non supporté. Symboles disponibles: ${brvmSymbols.join(', ')}`
      );
    }
  }

  private generateOrderTicket(orderId: string, params: OrderParams): string {
    const sideLabel = params.side === 'BUY' ? 'ACHAT' : 'VENTE';
    const priceStr = params.price ? `@ ${params.price} XOF` : '@ Market';
    const date = new Date().toLocaleDateString('fr-FR');

    return [
      `═══════════════════════════════════════`,
      `  TICKET D'ORDRE BRVM — ${orderId}`,
      `═══════════════════════════════════════`,
      ` Date:    ${date}`,
      ` Action:  ${sideLabel}`,
      ` Symbole: ${params.symbol}`,
      ` Quantité: ${params.quantity}`,
      ` Prix:    ${priceStr}`,
      ` Type:    ${params.type}`,
      `═══════════════════════════════════════`,
      ` Transmettez ce ticket à votre broker`,
      ` (SGCI, Coris, BOA, Ecobank, etc.)`,
      ` Règlement: T+3`,
      `═══════════════════════════════════════`,
    ].join('\n');
  }
}
