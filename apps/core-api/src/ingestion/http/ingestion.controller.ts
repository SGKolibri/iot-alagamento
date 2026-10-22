import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import type { IngestionPipeline } from '@iot/domain';
import { PIPELINE } from '../tokens';
import { bearerToken, error, messageResult } from './responses';

// Receber (HTTP): POST /api/v1/ingestao e POST /api/v1/ingestao/lote (RF-ING-02, RF-ING-03).
@Controller('ingestao')
export class IngestionController {
  constructor(@Inject(PIPELINE) private readonly pipeline: IngestionPipeline) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const outcome = await this.pipeline.ingestMessage({
      source: 'http',
      credential: bearerToken(authorization),
      body,
    });
    if (outcome.status === 'unauthorized') {
      throw new HttpException(
        error('nao_autenticado', 'credencial ausente ou inválida'),
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (outcome.status === 'refused') {
      throw new HttpException(
        error('mensagem_recusada', 'mensagem recusada', outcome.issues),
        HttpStatus.BAD_REQUEST,
      );
    }
    return { id_mensagem: outcome.messageId, resultado: messageResult(outcome).resultado };
  }

  @Post('lote')
  @HttpCode(HttpStatus.OK)
  async ingestBatch(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const outcome = await this.pipeline.ingestBatch({
      credential: bearerToken(authorization),
      body,
    });
    if (outcome.status === 'unauthorized') {
      throw new HttpException(
        error('nao_autenticado', 'credencial ausente ou inválida'),
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (outcome.status === 'rejected') {
      throw new HttpException(
        error('lote_invalido', 'lote recusado inteiro', outcome.issues),
        HttpStatus.BAD_REQUEST,
      );
    }
    return { id_lote: outcome.batchId, resultados: outcome.results.map(messageResult) };
  }
}
