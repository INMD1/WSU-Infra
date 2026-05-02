import { NextRequest, NextResponse } from 'next/server';
import { esxiClient } from '@/lib/infrastructure';

/**
 * GET /api/datastores
 * Datastore 목록 조회
 */
export async function GET(request: NextRequest) {
  try {
    const datastores = await esxiClient.listDatastores();

    return NextResponse.json({
      success: true,
      data: datastores,
      count: datastores.length
    });
  } catch (error: any) {
    console.error('[API] GET /api/datastores error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch datastores'
      },
      { status: 500 }
    );
  }
}
