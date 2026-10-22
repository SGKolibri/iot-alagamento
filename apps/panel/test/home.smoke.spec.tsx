import { render, screen } from '@testing-library/react';
import Home from '../app/page';

describe('teste de fumaça do painel', () => {
  it('renderiza a página inicial com o nome da plataforma', () => {
    render(<Home />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Plataforma IoT Integrada' }),
    ).toBeInTheDocument();
  });
});
