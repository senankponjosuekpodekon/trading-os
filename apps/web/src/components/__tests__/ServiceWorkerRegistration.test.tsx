import React from 'react';
import { render } from '@testing-library/react';
import { ServiceWorkerRegistration } from '../ServiceWorkerRegistration';

describe('ServiceWorkerRegistration', () => {
  let mockRegister: jest.Mock;

  beforeEach(() => {
    mockRegister = jest.fn().mockResolvedValue({ scope: '/' });
    Object.defineProperty(global.navigator, 'serviceWorker', {
      value: { register: mockRegister },
      writable: true,
      configurable: true,
    });
  });

  it('registers the service worker on load', () => {
    render(<ServiceWorkerRegistration />);
    window.dispatchEvent(new Event('load'));
    expect(mockRegister).toHaveBeenCalledWith('/sw.js');
  });

  it('does not break if service worker is not supported', () => {
    Object.defineProperty(global.navigator, 'serviceWorker', { value: undefined, writable: true, configurable: true });
    const { container } = render(<ServiceWorkerRegistration />);
    expect(container.firstChild).toBeNull();
  });
});
